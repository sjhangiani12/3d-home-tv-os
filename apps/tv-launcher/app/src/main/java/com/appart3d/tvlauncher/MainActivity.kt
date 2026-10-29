package com.appart3d.tvlauncher

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.view.animation.DecelerateInterpolator
import android.graphics.drawable.TransitionDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputFilter
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.inputmethod.EditorInfo
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Home screen of the TV: the block, live (the bridge's `/block.html?tv=1`, a pixel-art diorama of the street
 * with the 6 train, the Citi Bike docks, the weather and the home's lit windows), full screen and display only.
 * ↑ from the dock hands the remote to the page: it hops between its signs (Lights, Home, the station, the two
 * docks); OK zooms into a station or dock, or asks this app to open the apartment (with the Lights drawer or
 * without). Back steps out. The dock of a few chosen apps stays native, at the bottom.
 * "All apps" at the end of the dock opens every installed app.
 *
 * Provisioning over ADB (optional, the TV also finds the bridge with Bonjour and asks for the code):
 *   am start -n com.appart3d.tvlauncher/.MainActivity --es bridge http://<mac>:8787 --es pairCode <6 digits>
 */
class MainActivity : Activity() {
    private lateinit var store: BridgeStore
    private lateinit var catalog: AppCatalog
    private lateinit var discovery: BridgeDiscovery
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    private lateinit var web: WebView
    private lateinit var heroMessage: TextView
    private lateinit var lights: LightsPanel
    private lateinit var homePanel: FrameLayout
    /** The now-playing card at the foot of the home panel, and the speakers it chooses from. */
    private lateinit var npCard: LinearLayout
    private lateinit var npTitle: TextView
    private lateinit var npSub: TextView
    private lateinit var npPrev: TextView
    private lateinit var npPlay: TextView
    private lateinit var npNext: TextView
    private lateinit var npMore: TextView
    private val playing = LinkedHashMap<String, Playing>()
    /** The group the card shows: what the transport row acts on and what the details view lists. */
    private var nowPlaying: Playing? = null
    /** The rooms of that group with their own volumes, over the lamps while it is open. */
    private lateinit var speakers: SpeakersPanel
    private lateinit var speakersView: FrameLayout
    /** The lamps and the card, blocked from focus search while the details view covers them. */
    private lateinit var homeColumn: LinearLayout
    /**
     * The real apartment (the original 3D view, `/?view=3d`), shown when Lights opens and the block has flown to
     * the door. Preloaded after the block is up and kept paused while hidden, so it opens at once.
     */
    private var homeWeb: WebView? = null
    private var homeReady = false
    private var homeShowing = false
    private var atDoor = false
    private val preloadHome = Runnable { ensureHomeWeb() }
    private val pixel: Typeface by lazy { runCatching { resources.getFont(R.font.pixelify_sans) }.getOrDefault(Typeface.DEFAULT_BOLD) }
    private lateinit var drawer: FrameLayout
    private lateinit var drawerGrid: LinearLayout
    private var feed: HomeFeed? = null
    private lateinit var dockScroll: HorizontalScrollView
    private lateinit var dock: LinearLayout
    private lateinit var pairPanel: FrameLayout
    private lateinit var pairInput: EditText
    private lateinit var pairStatus: TextView

    private var loadedUrl: String? = null
    private var heroFailed = false
    private var appsDirty = false
    private var ambientKey = Ambient.key(null)
    /** Extra query for the 3D from ADB (`--es heroExtra "&stats=1&maxDpr=1.5"`), for tuning; not persisted. */
    private var heroExtra = ""
    private val retry = Runnable { reconnect() }
    private val pendingDim = HashMap<String, Runnable>()

    private val packageReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            appsDirty = true
            if (hasWindowFocus()) showApps()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashGuard.install(this)
        // The block is the screensaver: while the home screen shows, the TV stays awake (no Fire TV
        // screensaver, no sleep). Other apps keep the system's own timers.
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        store = BridgeStore(this)
        catalog = AppCatalog(this)
        discovery = BridgeDiscovery(this, ::onBridgeFound)
        setContentView(buildUi())
        registerReceiver(packageReceiver, IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addDataScheme("package")
        })
        showApps()
        if (!handleProvisioning(intent)) connect()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (handleProvisioning(intent)) return
        // Home pressed while already home: back to the top, first app focused.
        if (pairPanel.visibility != View.VISIBLE) goTop()
    }

    override fun onResume() {
        super.onResume()
        HomeButtonGuard.ensure(this)
        web.onResume()
        web.resumeTimers()
        if (homeShowing) homeWeb?.onResume()
        feed?.start()
        discovery.start()
        if (appsDirty) showApps()
        if (heroFailed) reconnect()
    }

    override fun onPause() {
        super.onPause()
        // An app is in front: stop the 3D rendering so it gets the whole (modest) GPU.
        web.onPause()
        homeWeb?.onPause()
        web.pauseTimers()
        feed?.stop()
        discovery.stop()
    }

    override fun onDestroy() {
        unregisterReceiver(packageReceiver)
        main.removeCallbacksAndMessages(null)
        feed?.stop()
        web.destroy()
        homeWeb?.destroy()
        io.shutdown()
        super.onDestroy()
    }

    @Deprecated("Home screen: Back only returns to the top.")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when {
            pairPanel.visibility == View.VISIBLE && store.token != null -> hidePairing()
            speakersView.visibility == View.VISIBLE -> hideSpeakers()
            homeShowing -> hideHome()
            web.hasFocus() -> postToBlock("back")
            drawer.visibility == View.VISIBLE -> hideDrawer()
            else -> goTop()
        }
    }

    // region Bridge

    /** `--es bridge <url> --es pairCode <code>` from ADB. True when it handled a pairing. */
    private fun handleProvisioning(intent: Intent?): Boolean {
        // Test hook (ADB only): `--ez crashApp true` crashes the app itself (checks CrashGuard).
        if (intent?.getBooleanExtra("crashApp", false) == true) {
            intent.removeExtra("crashApp")
            main.post { throw IllegalStateException("crashApp test hook") }
            return true
        }
        // Test hook (ADB only): `--ez crash3d true` crashes the 3D renderer to check the app survives it.
        if (intent?.getBooleanExtra("crash3d", false) == true) {
            intent.removeExtra("crash3d")
            web.loadUrl("chrome://crash")
            return true
        }
        // `--ef lat <deg> --ef lon <deg>`: where to read the weather. `--es dock "YouTube,Netflix,Plex"`: the dock's apps.
        if (intent?.hasExtra("lat") == true && intent.hasExtra("lon")) {
            WeatherSource.setPlace(this, intent.getFloatExtra("lat", 0f).toDouble(), intent.getFloatExtra("lon", 0f).toDouble())
        }
        intent?.getStringExtra("dock")?.let {
            catalog.setDock(it.split(',').map(String::trim).filter(String::isNotEmpty))
            showApps()
        }
        intent?.getStringExtra("heroExtra")?.let {
            heroExtra = it.filter { c -> c.isLetterOrDigit() || c in "&=._-" }
            reconnect()
        }
        intent?.getStringExtra("bridge")?.trim()?.trimEnd('/')?.takeIf { it.startsWith("http") }?.let {
            store.url = it
            loadedUrl = null
        }
        val code = intent?.getStringExtra("pairCode")?.trim() ?: return false
        intent.removeExtra("pairCode")
        submitCode(code)
        return true
    }

    /**
     * A bridge announced itself on the LAN. Keep the one we use while it answers: with two bridges on
     * the network (a test one, a neighbour's…) the TV must not flip to whichever was found last.
     */
    private fun onBridgeFound(url: String) {
        if (url == store.url) {
            if (heroFailed) reconnect()
            return
        }
        if (store.url != null && !heroFailed) return
        store.url = url
        reconnect()
    }

    private fun reconnect() {
        loadedUrl = null
        connect()
    }

    private fun connect() {
        main.removeCallbacks(retry)
        val base = store.url
        if (base == null) {
            showHeroMessage(getString(R.string.searching_bridge))
            if (store.token == null) showPairing()
            return
        }
        val token = store.token ?: return showPairing()
        // The block; `--es heroExtra "&pix=3&shadows=0"` trades crispness for frame rate (fps in logcat, tag Maison).
        val url = "$base/block.html?tv=1$heroExtra"
        if (url == loadedUrl && !heroFailed) return
        dropHomeWeb()
        startFeed(base, token)
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setCookie(base, "$COOKIE_NAME=$token; Path=/; Max-Age=31536000; SameSite=Lax") {
            cookies.flush()
            loadedUrl = url
            heroFailed = false
            web.animate().cancel()
            web.alpha = 0f
            web.loadUrl(url)
        }
    }

    private fun heroFailed(message: String) {
        heroFailed = true
        web.animate().alpha(0f).setDuration(300).start()
        showHeroMessage(message)
        main.removeCallbacks(retry)
        main.postDelayed(retry, 30_000)
    }

    private fun startFeed(base: String, token: String) {
        feed?.stop()
        feed = HomeFeed(
            base, token,
            onLamps = { lamps -> main.post { lights.setLamps(lamps) } },
            onLamp = { lamp -> main.post { lights.update(lamp) } },
            onSun = { elevation -> main.post { setSun(elevation) } },
            onScenes = { scenes -> main.post { lights.setScenes(scenes) } },
            onPlaying = { list -> main.post { playing.clear(); list.forEach { playing[it.id] = it }; renderPlaying() } },
            onSpeaker = { id, p -> main.post { if (p == null) playing.remove(id) else playing[id] = p; renderPlaying() } },
        ).also { it.start() }
    }

    /** Background palette follows the sun (day, golden hour, night), cross-faded when it changes. */
    private fun setSun(elevation: Double?) {
        val key = Ambient.key(elevation)
        if (key == ambientKey) return
        ambientKey = key
        val root = window.decorView.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        val fade = TransitionDrawable(arrayOf(root.background, Ambient.forSun(elevation)))
        fade.isCrossFadeEnabled = true
        root.background = fade
        fade.startTransition(1500)
    }

    /** OK on a lamp: shows the new state at once, then the bridge's answer (or the old state on failure). */
    private fun toggle(lamp: Lamp) {
        val base = store.url ?: return
        val token = store.token ?: return
        val on = lamp.on != true
        lights.update(lamp.copy(on = on))
        io.execute {
            val result = runCatching { HomeFeed.power(base, token, lamp, on) }
            main.post {
                result.onSuccess { it?.let(lights::update) }.onFailure {
                    lights.update(lamp)
                    toast(getString(R.string.command_failed, lamp.name))
                }
            }
        }
    }

    /** ← / → on a lamp: shown at once, sent once the key is released for a moment (no flood while held). */
    private fun dim(lamp: Lamp, value: Int) {
        val base = store.url ?: return
        val token = store.token ?: return
        lights.update(lamp.copy(on = true, brightness = value))
        pendingDim.remove(lamp.id)?.let(main::removeCallbacks)
        val send = Runnable {
            pendingDim.remove(lamp.id)
            io.execute {
                val result = runCatching { HomeFeed.brightness(base, token, lamp, value) }
                main.post { result.onFailure { toast(getString(R.string.setting_failed, lamp.name)) } }
            }
        }
        pendingDim[lamp.id] = send
        main.postDelayed(send, 250)
    }

    /** ← / → on the fan: motor speed, shown at once, sent once the key settles (like the dimmer). */
    private fun fanSpeed(lamp: Lamp, step: Int) {
        val base = store.url ?: return
        val token = store.token ?: return
        lights.update(lamp.copy(fanSpeed = step))
        pendingDim.remove(lamp.id)?.let(main::removeCallbacks)
        val send = Runnable {
            pendingDim.remove(lamp.id)
            io.execute {
                val result = runCatching { HomeFeed.fanSpeed(base, token, lamp, step) }
                main.post { result.onFailure { toast(getString(R.string.setting_failed, lamp.name)) } }
            }
        }
        pendingDim[lamp.id] = send
        main.postDelayed(send, 350)
    }

    /**
     * The remote is on a lamp: outline it in the 3D and fly there (from an angle with no wall in front)
     * so guests know which lamp it is before toggling. Sent 150 ms after the focus settles.
     */
    private fun spotlight(lamp: Lamp?) {
        main.removeCallbacks(sendSpotlight)
        pendingSpotlight = lamp?.id
        main.postDelayed(sendSpotlight, 150)
    }

    private var pendingSpotlight: String? = null
    private var sentSpotlight: String? = null
    private val sendSpotlight = Runnable {
        val id = pendingSpotlight
        if (id == sentSpotlight) return@Runnable
        sentSpotlight = id
        val cmd = JSONObject().put("type", "spotlightDevice").put("deviceId", id ?: JSONObject.NULL)
        homeWeb?.evaluateJavascript("window.appart3dEmbed && window.appart3dEmbed.post($cmd)", null)
    }

    private fun runScene(scene: Scene) {
        val base = store.url ?: return
        val token = store.token ?: return
        io.execute {
            val result = runCatching { HomeFeed.scene(base, token, scene.id) }
            main.post { result.onFailure { toast(getString(R.string.scene_failed, scene.name)) } }
        }
    }

    /**
     * "Inputs": Fire OS keeps input switching to its own signed apps, so the bridge presses the TV's
     * Inputs key over ADB and the TV draws its own picker over us.
     */
    private fun openInputs() {
        val base = store.url ?: return
        val token = store.token ?: return
        io.execute {
            val result = runCatching { HomeFeed.tvInputs(base, token) }
            main.post { result.onFailure { toast(getString(R.string.inputs_failed)) } }
        }
    }

    /** "Tout éteindre": the lights only (the TV stays on, unlike the "Absent" scene). */
    private fun allOff() {
        lights.lamps().filter { it.on == true && it.reachable }.forEach(::toggle)
    }

    private fun unauthorized() {
        feed?.stop()
        feed = null
        store.token = null
        loadedUrl = null
        web.alpha = 0f
        showHeroMessage(getString(R.string.tv_not_paired))
        showPairing()
    }

    private fun submitCode(raw: String) {
        val code = raw.filter(Char::isDigit)
        if (code.length != 6) return setPairStatus(getString(R.string.pair_code_length))
        val base = store.url ?: return setPairStatus(getString(R.string.pair_no_bridge))
        setPairStatus(getString(R.string.pairing))
        io.execute {
            val result = runCatching { BridgeApi.pair(base, code, "TV ${Build.MODEL}") }
            main.post {
                result.onSuccess { token ->
                    if (token == null) return@onSuccess setPairStatus(getString(R.string.pair_wrong_code))
                    store.token = token
                    hidePairing()
                    reconnect()
                }.onFailure { setPairStatus(getString(R.string.bridge_unreachable_reason, it.message ?: getString(R.string.network_error))) }
            }
        }
    }

    /** Messages from a web page (`window.appart3dAndroid.postMessage`), on a WebView thread; `home`: the apartment view. */
    private inner class EmbedBridge(private val home: Boolean) {
        @JavascriptInterface
        fun postMessage(json: String) {
            val msg = runCatching { JSONObject(json) }.getOrNull() ?: return
            main.post {
                if (home) {
                    if (msg.optString("type") == "ready") {
                        homeReady = true
                        if (homeShowing) revealHome() else homeWeb?.onPause()
                    }
                    return@post
                }
                when (msg.optString("type")) {
                    "ready" -> {
                        heroMessage.animate().alpha(0f).setDuration(400).start()
                        web.animate().alpha(1f).setDuration(900).start()
                        main.removeCallbacks(preloadHome)
                        main.postDelayed(preloadHome, 6000)
                    }
                    "atDoor" -> {
                        atDoor = true
                        showHomePanel()
                        revealHome()
                    }
                    "focusDock" -> focusDock()
                    // Lights and Home are two doors into the same room, as they already are in the browser.
                    // Home used to land on the apartment with no panel and nothing to press, which read as
                    // the lights having gone missing.
                    "openLights", "viewHome" -> showHome()
                    // Zoomed into a station or a dock: the dock steps aside.
                    "poi" -> dockScroll.animate().alpha(if (msg.optBoolean("on")) 0f else 1f).setDuration(250).start()
                    "error" -> {
                        val text = msg.optString("message")
                        if (text.startsWith("Accès refusé")) unauthorized() else heroFailed(text.ifEmpty { getString(R.string.bridge_unreachable) })
                    }
                }
            }
        }
    }

    // endregion

    // region UI

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildUi(): View {
        val root = FrameLayout(this).apply { background = Ambient.forSun(null) }

        // The block, full screen. It takes the remote when ↑ is pressed on the dock (see EmbedBridge).
        heroMessage = TextView(this).apply {
            setTextColor(0x99FFFFFF.toInt())
            textSize = 20f
            gravity = Gravity.CENTER
        }
        root.addView(heroMessage, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web = createWeb()
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // Dock: one row of apps at the bottom, then "All apps" and Settings.
        dock = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            clipChildren = false
            clipToPadding = false
            setPadding(dp(SIDE), dp(14), dp(SIDE), dp(14))
        }
        dockScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            isSmoothScrollingEnabled = true
            clipChildren = false
            clipToPadding = false
            isFocusable = false
            addView(dock, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        root.addView(dockScroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
            bottomMargin = dp(10)
        })

        // Home drawer (right): the lamps, while the page shows the apartment beside it.
        lights = LightsPanel(this, ::toggle, ::dim, ::fanSpeed, ::spotlight, ::runScene, ::allOff)
        homePanel = buildHomePanel()
        root.addView(homePanel, FrameLayout.LayoutParams(dp(HOME_W), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.END))

        drawer = buildDrawer()
        root.addView(drawer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        pairPanel = buildPairPanel()
        root.addView(pairPanel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return root
    }

    private fun buildHomePanel(): FrameLayout {
        val column = LinearLayout(this).also { homeColumn = it }.apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(24), dp(12), dp(14))
            addView(TextView(context).apply {
                text = getString(R.string.home_title)
                setTextColor(INK)
                textSize = 22f
                typeface = pixel
            })
            addView(lights, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = dp(10) })
            addView(buildNowPlaying(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(TextView(context).apply {
                text = getString(R.string.home_hint)
                setTextColor(0xFF6A6170.toInt())
                textSize = 10f
                typeface = pixel
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        }
        speakers = SpeakersPanel(this, ::setVolume)
        speakersView = FrameLayout(this).apply {
            setBackgroundColor(PAPER)
            visibility = View.GONE
            isClickable = true
            setPadding(dp(16), dp(24), dp(12), dp(14))
            addView(speakers, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        return FrameLayout(this).apply {
            setBackgroundColor(PAPER)
            visibility = View.GONE
            translationX = dp(HOME_W).toFloat()
            isClickable = true
            addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(speakersView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(View(context).apply { setBackgroundColor(INK) }, FrameLayout.LayoutParams(dp(2), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.START))
        }
    }

    /**
     * What the home is playing, under the lamps: the track, then a row of transport keys. ↓ off the last lamp
     * lands on the title, which opens the app the music comes from; ↓ again is the row that pauses it, skips,
     * or opens the rooms and their volumes. When the house is silent the card stays, naming a room that can
     * be started, so ▶ always has somewhere to go — and the keys that the source does not allow (a TV stream
     * has none, radio cannot skip, a silent room has nothing to skip to) are hidden rather than shown dead.
     */
    private fun buildNowPlaying(): LinearLayout {
        npTitle = TextView(this).apply {
            setTextColor(INK)
            textSize = 13f
            typeface = pixel
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            isFocusable = true
            setPadding(dp(4), dp(2), dp(4), dp(2))
            setOnClickListener { openMusicApp() }
            setOnFocusChangeListener { _, f -> paintNpFocus(npTitle, f) }
        }
        npSub = TextView(this).apply {
            setTextColor(0xFF6A6170.toInt())
            textSize = 10f
            typeface = pixel
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(4), 0, dp(4), 0)
        }
        npPrev = npKey("⏮") { sendMedia("previous") }
        npPlay = npKey("⏯") { sendMedia("playPause") }
        npNext = npKey("⏭") { sendMedia("next") }
        npMore = npKey("≡") { showSpeakers() }
        npCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(dp(4), dp(8), dp(4), dp(2))
            addView(View(context).apply { setBackgroundColor(0x22000000) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply { bottomMargin = dp(8) })
            addView(npTitle)
            addView(npSub)
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                clipChildren = false
                setPadding(dp(2), dp(6), dp(2), dp(2))
                listOf(npPrev, npPlay, npNext, npMore).forEach {
                    addView(it, LinearLayout.LayoutParams(0, dp(28), 1f).apply { leftMargin = dp(3); rightMargin = dp(3) })
                }
            })
        }
        return npCard
    }

    /** One transport key of the card: a small paper pill that turns to ink under the remote. */
    private fun npKey(glyph: String, onClick: () -> Unit): TextView {
        val key = TextView(this)
        key.text = glyph
        key.textSize = 13f
        key.typeface = pixel
        key.gravity = Gravity.CENTER
        key.isFocusable = true
        key.setOnClickListener { onClick() }
        key.setOnFocusChangeListener { _, f -> paintNpFocus(key, f) }
        paintNpFocus(key, false)
        return key
    }

    private fun paintNpFocus(view: TextView, focused: Boolean) {
        view.background = if (focused) GradientDrawable().apply { setColor(INK) } else null
        view.setTextColor(if (focused) PAPER else INK)
    }

    /**
     * The one speaker group worth showing: a room the remote can actually drive first — the TV's own sound
     * is a stream with no transport, so it loses to music even when it is the loud thing in the room — then
     * something loaded before something silent, playing before paused, then whichever fills the most rooms.
     * Re-run on every change from the bridge, so the card follows the music from room to room.
     */
    private fun renderPlaying() {
        val np = playing.values.maxWithOrNull(compareBy({ it.canPlayPause }, { !it.idle }, { it.playing }, { it.rooms }, { it.title }))
        nowPlaying = np
        npCard.visibility = if (np == null) View.GONE else View.VISIBLE
        if (np == null) return hideSpeakers()
        npTitle.text = if (np.idle) getString(R.string.np_nothing) else "${if (np.playing) "♪" else "❚❚"} ${np.title}"
        // Only a track that leads somewhere takes the remote; otherwise ↓ off the lamps goes straight to the keys.
        npTitle.isFocusable = np.app in MUSIC_APPS
        val where = if (np.rooms > 1) getString(R.string.np_rooms, np.where, np.rooms) else np.where
        npSub.text = if (np.artist.isEmpty()) where else "${np.artist} · $where"
        // Nothing is loaded, so there is nothing to skip past: ▶ is the only thing that means anything.
        npPrev.visibility = if (np.canPrevious && !np.idle) View.VISIBLE else View.GONE
        npPlay.visibility = if (np.canPlayPause) View.VISIBLE else View.GONE
        npNext.visibility = if (np.canNext && !np.idle) View.VISIBLE else View.GONE
        npPlay.text = if (np.playing) "❚❚" else "▶"
        if (speakersView.visibility == View.VISIBLE) speakers.setSpeakers(np.title, groupOf(np))
    }

    /** Every room playing this, the group's lead first — one `Playing` each, each with its own volume. */
    private fun groupOf(np: Playing): List<Playing> =
        playing.values.filter { it.where == np.where }.sortedByDescending { it.name == it.where }

    /** A transport key: shown at once on the card, then confirmed (or undone) by the bridge's own event. */
    private fun sendMedia(command: String) {
        val np = nowPlaying ?: return
        val base = store.url ?: return
        val token = store.token ?: return
        // A silent room has no "other" state to show early: wait for the bridge to say what it started.
        if (command == "playPause" && !np.idle) {
            playing[np.id] = np.copy(playing = !np.playing)
            renderPlaying()
        }
        io.execute {
            val result = runCatching { HomeFeed.media(base, token, np, command) }
            main.post { result.onFailure { toast(getString(R.string.command_failed, np.where)) } }
        }
    }

    /** ← / → on a room of the details view: shown at once, sent straight away (volume is cheap and per room). */
    private fun setVolume(speaker: Playing, value: Int) {
        val base = store.url ?: return
        val token = store.token ?: return
        playing[speaker.id] = speaker.copy(volume = value)
        nowPlaying?.let { speakers.setSpeakers(it.title, groupOf(it)) }
        io.execute {
            val result = runCatching { HomeFeed.volume(base, token, speaker, value) }
            main.post { result.onFailure { toast(getString(R.string.setting_failed, speaker.name)) } }
        }
    }

    /** The rooms and their volumes, over the lamps. Back (or the music stopping) brings the lamps back. */
    private fun showSpeakers() {
        val np = nowPlaying ?: return
        speakers.setSpeakers(np.title, groupOf(np))
        if (speakers.isEmpty()) return
        speakersView.visibility = View.VISIBLE
        // A sibling overlay does not stop focus search on its own: ↓ off the last room would land on a lamp
        // behind it. Same confinement the All-apps drawer needs, for the same reason.
        homeColumn.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        speakersView.post { speakers.focusFirst() }
    }

    private fun hideSpeakers(refocus: Boolean = true) {
        if (speakersView.visibility != View.VISIBLE) return
        speakersView.visibility = View.GONE
        homeColumn.descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
        if (!refocus) return
        if (npCard.visibility == View.VISIBLE) npMore.requestFocus() else lights.requestFocus()
    }

    /**
     * OK on the track: the app the sound comes from, on the TV itself. The bridge names the source as Sonos
     * reports it ("Spotify", "Apple Music", "TV"…); what is not an app we can open — a radio stream, the TV's
     * own sound — leaves the title inert rather than opening something arbitrary. Spotify TV is often not
     * installed on a Fire TV, so the fallback is its page in the Appstore: one more OK and it is there.
     */
    private fun openMusicApp() {
        val pkg = MUSIC_APPS[nowPlaying?.app] ?: return
        val intent = catalog.launchIntent(pkg)
        if (intent != null) return start(intent)
        start(Intent(Intent.ACTION_VIEW, Uri.parse("amzn://apps/android?p=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Creates and loads the apartment view (hidden, under the native views) if it is not there yet. */
    private fun ensureHomeWeb() {
        if (homeWeb != null) return
        val base = store.url ?: return
        if (store.token == null) return
        val root = web.parent as? ViewGroup ?: return
        val h = createWeb(home = true)
        homeWeb = h
        homeReady = false
        root.addView(h, root.indexOfChild(web) + 1, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // maxDpr=1.5: ~57 fps on this TV vs ~48 at 2x, hardly less sharp from the sofa (see ?stats=1).
        // panel: the lamp panel covers that much of the right, so the apartment frames itself in the rest
        // (CSS px = dp here — the page sets width=device-width). The block page does the same for its own.
        h.loadUrl("$base/?view=3d&lite=1&orbit=full&tilt=64&maxDpr=1.5&panel=$HOME_W")
    }

    private fun dropHomeWeb() {
        val h = homeWeb ?: return
        homeWeb = null
        homeReady = false
        (h.parent as? ViewGroup)?.removeView(h)
        h.destroy()
        sentSpotlight = null
        // Gone while it was on screen (dropped for memory, or its renderer died): the block page is paused
        // underneath with its own apartment stepped off, so the screen is a frozen, empty backdrop. Wake it
        // and give the stand-in back.
        if (homeShowing) {
            web.onResume()
            postRealHome(false)
        }
    }

    /** At the door and loaded: the apartment fades in over the block, which pauses underneath. */
    private fun revealHome() {
        if (!homeShowing || !atDoor) return
        val h = homeWeb ?: return ensureHomeWeb()
        if (!homeReady) return
        h.onResume()
        // This view draws on a transparent canvas, so the block page's stand-in apartment would show
        // straight through the real one. It steps off first and leaves its backdrop to fade into.
        postRealHome(true)
        h.animate().alpha(1f).setDuration(600).withEndAction { if (homeShowing) web.onPause() }.start()
    }

    /** `panel` tells the page this panel is about to cover the right of the screen, so it can aim off centre. */
    private fun postToBlock(type: String, panel: Boolean = false) {
        val extra = if (panel) ",panel:true" else ""
        web.evaluateJavascript("window.appart3dEmbed && window.appart3dEmbed.post({type:'$type'$extra})", null)
    }

    /** The real scan is up over the block page (or gone again), so its stand-in apartment steps off (or back). */
    private fun postRealHome(on: Boolean) {
        web.evaluateJavascript("window.appart3dEmbed && window.appart3dEmbed.post({type:'realHome',on:$on})", null)
    }

    /**
     * The apartment: the page flies to the door, then the real 3D home fades in, with the lamp panel sliding
     * in beside it and taking the remote. Back returns to the block.
     */
    private fun showHome() {
        if (homeShowing) return
        homeShowing = true
        atDoor = false
        ensureHomeWeb()
        dockScroll.animate().alpha(0f).setDuration(220).withEndAction { if (homeShowing) dockScroll.visibility = View.INVISIBLE }.start()
        postToBlock("openHome", panel = true)
        // The panel waits for the apartment. It used to slide in on the press, so a page-high slab of lamps
        // sat over the whole walk down the street and through the door. Back still closes the lot from the
        // first frame -- `onBackPressed` asks `homeShowing`, not who holds the focus.
        main.removeCallbacks(panelFallback)
        main.postDelayed(panelFallback, 7000)
    }

    /**
     * The apartment is up (or near enough): the lamps slide in beside it and take the remote. Idempotent --
     * the page's `atDoor` and the fallback below both land here, and whichever is first wins.
     */
    private fun showHomePanel() {
        if (!homeShowing || homePanel.visibility == View.VISIBLE) return
        main.removeCallbacks(panelFallback)
        homePanel.visibility = View.VISIBLE
        homePanel.animate().translationX(0f).setDuration(420).setInterpolator(DecelerateInterpolator()).start()
        lights.requestFocus()
    }

    /** If the page never reaches the door -- a stale build, a dead renderer -- the lamps still arrive. */
    private val panelFallback = Runnable { showHomePanel() }

    private fun hideHome(refocus: Boolean = true) {
        if (!homeShowing) return
        homeShowing = false
        atDoor = false
        main.removeCallbacks(panelFallback)
        hideSpeakers(refocus = false)
        web.onResume()
        homeWeb?.let { h -> h.animate().alpha(0f).setDuration(400).withEndAction { if (!homeShowing) h.onPause() }.start() }
        if (homePanel.visibility == View.VISIBLE) homePanel.animate().translationX(dp(HOME_W).toFloat()).setDuration(320).withEndAction { homePanel.visibility = View.GONE }.start()
        dockScroll.visibility = View.VISIBLE
        dockScroll.animate().alpha(1f).setDuration(300).start()
        spotlight(null)
        postToBlock("closeHome")
        if (refocus) web.requestFocus()
    }

    /** Back to the dock (the page has nothing more above, or ↓ past its lowest sign). */
    private fun focusDock() {
        (dock.findFocus() ?: dock.getChildAt(0))?.requestFocus()
    }

    /** The 3D view. Recreated from scratch when its renderer dies (see onRenderProcessGone). */
    @SuppressLint("SetJavaScriptEnabled")
    private fun createWeb(home: Boolean = false): WebView = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            alpha = 0f
            defaultFocusHighlightEnabled = false
            // The block takes the remote (its signs); the apartment view is display only.
            isFocusable = !home
            isFocusableInTouchMode = false
            if (!home) {
                id = WEB_ID
                setOnFocusChangeListener { _, f -> postToBlock(if (f) "focusIn" else "focusOut") }
            }
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(EmbedBridge(home), "appart3dAndroid")
            // `?stats=1` lines from the 3D (tuning): relayed to logcat, tag "Maison".
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                    if (m.message().startsWith("[appart3d-stats]") || m.message().startsWith("[block]")) Log.i("Maison", m.message())
                    return true
                }
            }
            webViewClient = object : WebViewClient() {
                /**
                 * The 3D's renderer crashed or was killed for memory. Unhandled, Android kills the whole
                 * app — dock, lights panel and Home key with it. Replace the WebView, keep the rest up.
                 */
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    Log.w("Maison", "3D renderer gone (crash=${detail.didCrash()}), recreating it")
                    main.post { replaceWeb(view) }
                    return true
                }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (!request.isForMainFrame) return
                    if (home) main.post { dropHomeWeb() } else heroFailed(getString(R.string.bridge_unreachable))
                }
                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                    if (!request.isForMainFrame) return
                    if (home) {
                        main.post { dropHomeWeb() }
                        return
                    }
                    if (response.statusCode == 401) unauthorized() else heroFailed(getString(R.string.bridge_unreachable_status, response.statusCode))
                }
            }
        }

    private fun replaceWeb(dead: WebView) {
        // The apartment view: drop it, it comes back on the next Lights (the block stays up).
        if (dead === homeWeb) return dropHomeWeb()
        if (dead !== web) return
        val parent = dead.parent as? ViewGroup ?: return
        val index = parent.indexOfChild(dead)
        val lp = dead.layoutParams
        parent.removeView(dead)
        dead.destroy()
        web = createWeb()
        parent.addView(web, index, lp)
        loadedUrl = null
        sentSpotlight = null
        showHeroMessage(getString(R.string.restarting_3d))
        main.postDelayed({ reconnect() }, 3000)
    }

    private fun showApps() {
        appsDirty = false
        val focusedPkg = currentFocus?.tag as? String
        dock.removeAllViews()
        val tileW = dp(TILE_W)
        val tiles = catalog.load().map { app ->
            tile(app.pkg, app.label, app.banner, app.icon, tileW, tileW * 9 / 16) { launch(app.pkg) }
        } + tile(ALL_APPS_TAG, getString(R.string.all_apps), null, getDrawable(android.R.drawable.ic_dialog_dialer), tileW * 9 / 16, tileW * 9 / 16) {
            showDrawer()
        } + tile(SETTINGS_TAG, getString(R.string.settings), null, getDrawable(android.R.drawable.ic_menu_preferences), tileW * 9 / 16, tileW * 9 / 16) {
            start(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        tiles.forEachIndexed { i, t ->
            dock.addView(t, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                if (i > 0) leftMargin = dp(GAP)
            })
        }
        val refocus = tiles.firstOrNull { it.tag == focusedPkg } ?: tiles.firstOrNull()
        if (pairPanel.visibility != View.VISIBLE && drawer.visibility != View.VISIBLE) refocus?.requestFocus()
    }

    /** Every installed app, in rows, over the home screen. Back closes it. */
    private fun buildDrawer(): FrameLayout {
        drawerGrid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            clipChildren = false
            clipToPadding = false
            setPadding(dp(SIDE) + dp(8), dp(16), dp(SIDE), dp(32))
        }
        return FrameLayout(this).apply {
            setBackgroundColor(0xE6000000.toInt())
            visibility = View.GONE
            isClickable = true
            addView(TextView(context).apply {
                text = getString(R.string.all_apps)
                setTextColor(Color.WHITE)
                textSize = 24f
                typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                leftMargin = dp(SIDE)
                topMargin = dp(TOP + 8)
            })
            addView(android.widget.ScrollView(context).apply {
                isVerticalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER
                clipChildren = false
                clipToPadding = false
                isFocusable = false
                addView(drawerGrid)
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply { topMargin = dp(TOP + 48) })
        }
    }

    private fun showDrawer() {
        drawerGrid.removeAllViews()
        // As wide as fits DRAWER_COLS a row, with the zoom of the focused tile.
        val tileW = (resources.displayMetrics.widthPixels - dp(SIDE) * 2 - dp(GAP) * (DRAWER_COLS - 1)) / DRAWER_COLS * 10 / 11
        // The TV's own inputs first: what is plugged into the HDMI ports has no app to be found under.
        if (store.url != null && store.token != null) {
            drawerGrid.addView(drawerHeading(getString(R.string.inputs)))
            drawerRows(listOf(DrawerTile(INPUT_TAG, getString(R.string.inputs), getDrawable(R.drawable.ic_input)) {
                hideDrawer()
                openInputs()
            }), tileW)
            drawerGrid.addView(drawerHeading(getString(R.string.apps)))
        }
        drawerRows(catalog.all().map { app ->
            DrawerTile(app.pkg, app.label, app.icon ?: app.banner) {
                hideDrawer()
                launch(app.pkg)
            }
        }, tileW)
        drawer.visibility = View.VISIBLE
        confineFocusToDrawer(true)
        (0 until drawerGrid.childCount).asSequence()
            .mapNotNull { (drawerGrid.getChildAt(it) as? ViewGroup)?.getChildAt(0) }
            .firstOrNull()?.requestFocus()
    }

    /**
     * The drawer covers the screen but the dock and the block are still in the view tree, so ↓ off the
     * last row (or ↑ off the first, which every tile sends to the block) walked the remote onto buttons
     * hidden behind it. While it is open nothing underneath may take focus: Back is the only way out.
     */
    private fun confineFocusToDrawer(confined: Boolean) {
        val behind = if (confined) ViewGroup.FOCUS_BLOCK_DESCENDANTS else ViewGroup.FOCUS_AFTER_DESCENDANTS
        dockScroll.descendantFocusability = behind
        homePanel.descendantFocusability = behind
        web.isFocusable = !confined
    }

    private data class DrawerTile(val tag: String, val label: String, val icon: android.graphics.drawable.Drawable?, val onClick: () -> Unit)

    /** Lays tiles out DRAWER_COLS a row, each with its name under it, and appends the rows to the drawer. */
    private fun drawerRows(tiles: List<DrawerTile>, tileW: Int) {
        var row: LinearLayout? = null
        tiles.forEachIndexed { i, item ->
            if (i % DRAWER_COLS == 0) {
                row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    clipChildren = false
                }
                drawerGrid.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(18) })
            }
            val t = tile(item.tag, item.label, null, item.icon, tileW, tileW * 9 / 16, item.onClick) as LinearLayout
            t.addView(TextView(this).apply {
                text = item.label
                setTextColor(0xCCFFFFFF.toInt())
                textSize = 13f
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(tileW, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
            row?.addView(t, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                if (i % DRAWER_COLS > 0) leftMargin = dp(GAP)
            })
        }
    }

    private fun drawerHeading(text: String): TextView = TextView(this).apply {
        this.text = text
        setTextColor(0x99FFFFFF.toInt())
        textSize = 14f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setPadding(0, 0, 0, dp(10))
    }


    private fun hideDrawer() {
        drawer.visibility = View.GONE
        drawerGrid.removeAllViews()
        confineFocusToDrawer(false)
        dock.findViewWithTag<View>(ALL_APPS_TAG)?.requestFocus()
    }

    private fun tile(tag: String, label: String, banner: android.graphics.drawable.Drawable?, icon: android.graphics.drawable.Drawable?, width: Int, height: Int, onClick: () -> Unit): View {
        val card = FrameLayout(this).apply {
            background = GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(0xFF2A2F38.toInt())
            }
            outlineProvider = ViewOutlineProvider.BACKGROUND
            clipToOutline = true
            elevation = dp(6).toFloat()
        }
        if (banner != null) {
            card.addView(ImageView(this).apply {
                setImageDrawable(banner)
                scaleType = ImageView.ScaleType.CENTER_CROP
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        } else {
            val size = minOf(width, height) / 2
            card.addView(ImageView(this).apply {
                setImageDrawable(icon)
                scaleType = ImageView.ScaleType.FIT_CENTER
                alpha = 0.8f
            }, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
        }
        // Glass sheen + bright rim on the focused app (tvOS look).
        val shine = View(this).apply {
            background = Glass(dp(14).toFloat(), dp(2).toFloat(), fillTop = 0, fillBottom = 0, sheen = 0x40FFFFFF, rimTop = 0xCCFFFFFF.toInt(), rimBottom = 0x26FFFFFF)
            alpha = 0f
        }
        card.addView(shine, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return LinearLayout(this).apply {
            this.tag = tag
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false
            isFocusable = true
            nextFocusUpId = WEB_ID
            contentDescription = label
            addView(card, LinearLayout.LayoutParams(width, height))
            setOnClickListener { onClick() }
            setOnFocusChangeListener { _, focused ->
                val scale = if (focused) 1.15f else 1f
                card.animate().scaleX(scale).scaleY(scale).translationZ(if (focused) dp(18).toFloat() else 0f).setDuration(180).start()
                shine.animate().alpha(if (focused) 1f else 0f).setDuration(180).start()
            }
        }
    }

    private fun goTop() {
        hideHome(refocus = false)
        postToBlock("reset")
        if (drawer.visibility == View.VISIBLE) {
            drawer.visibility = View.GONE
            drawerGrid.removeAllViews()
            confineFocusToDrawer(false)
        }
        dockScroll.smoothScrollTo(0, 0)
        dock.getChildAt(0)?.requestFocus()
    }

    private fun launch(pkg: String) {
        val intent = catalog.launchIntent(pkg) ?: return toast(getString(R.string.cannot_open_app))
        start(intent)
    }

    private fun start(intent: Intent) {
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            toast(getString(R.string.cannot_open_app))
        } catch (_: SecurityException) {
            toast(getString(R.string.cannot_open_app))
        }
    }

    private fun showHeroMessage(text: String) {
        heroMessage.text = text
        heroMessage.animate().alpha(1f).setDuration(300).start()
    }

    private fun buildPairPanel(): FrameLayout {
        val title = TextView(this).apply {
            text = getString(R.string.pair_title)
            setTextColor(Color.WHITE)
            textSize = 28f
            gravity = Gravity.CENTER
        }
        val hint = TextView(this).apply {
            text = getString(R.string.pair_hint)
            setTextColor(0xB3FFFFFF.toInt())
            textSize = 16f
            gravity = Gravity.CENTER
        }
        pairInput = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            filters = arrayOf(InputFilter.LengthFilter(6))
            imeOptions = EditorInfo.IME_ACTION_DONE
            setTextColor(Color.WHITE)
            textSize = 34f
            letterSpacing = 0.4f
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(0xFF2A2F38.toInt())
            }
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setOnEditorActionListener { _, action, event ->
                val done = action == EditorInfo.IME_ACTION_DONE || event?.keyCode == KeyEvent.KEYCODE_ENTER
                if (done) submitCode(text.toString())
                done
            }
        }
        pairStatus = TextView(this).apply {
            setTextColor(0xB3FFFFFF.toInt())
            textSize = 16f
            gravity = Gravity.CENTER
        }
        val ok = Button(this).apply {
            text = getString(R.string.pair_ok)
            setOnClickListener { submitCode(pairInput.text.toString()) }
        }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            val lp = { top: Int -> LinearLayout.LayoutParams(dp(420), ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) } }
            addView(title, lp(0))
            addView(hint, lp(14))
            addView(pairInput, lp(28))
            addView(ok, lp(18))
            addView(pairStatus, lp(18))
        }
        return FrameLayout(this).apply {
            setBackgroundColor(0xEB000000.toInt())
            visibility = View.GONE
            isClickable = true
            addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        }
    }

    private fun showPairing() {
        if (pairPanel.visibility == View.VISIBLE) return
        pairStatus.text = if (store.url == null) getString(R.string.searching_bridge) else ""
        pairPanel.visibility = View.VISIBLE
        pairInput.requestFocus()
    }

    private fun hidePairing() {
        pairPanel.visibility = View.GONE
        pairInput.text.clear()
        goTop()
    }

    private fun setPairStatus(text: String) {
        if (pairPanel.visibility == View.VISIBLE) pairStatus.text = text else if (text.isNotEmpty() && !text.endsWith("…")) toast(text)
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    // endregion

    companion object {
        private const val COOKIE_NAME = "appart3d_home"
        private const val SETTINGS_TAG = "__settings"
        private const val INK = 0xFF1C1A24.toInt()
        private const val PAPER = 0xFFFBF6EA.toInt()
        /** Home drawer width (dp): 500 px of the block page's 1920 px frame. */
        private const val HOME_W = 250
        /** The block's WebView id (stable across its re-creation), for the dock's ↑. */
        private val WEB_ID = View.generateViewId()
        /**
         * The source name the bridge reads off the speaker → the app to open on the TV. Fire OS package
         * names: Spotify ships a separate TV build, Amazon Music and TuneIn are the Fire TV ones. A source
         * that is not here (Radio, Music library, the TV's own sound) leaves the track inert.
         */
        private val MUSIC_APPS = mapOf(
            "Spotify" to "com.spotify.tv.android",
            "Amazon Music" to "com.amazon.bueller.music",
            "TuneIn" to "tunein.player",
        )
        private const val ALL_APPS_TAG = "__all_apps"
        private const val INPUT_TAG = "__inputs"
        private const val SIDE = 40
        private const val GAP = 24
        /**
         * Dock tile width (dp), 16:9 banners. Kept a fifth smaller than it reads naturally, because the
         * row sits over a live 3D block rather than a black bar: every dp off a tile is a dp of street
         * back, and the block's lowest signs sit just above this row.
         */
        private const val TILE_W = 112
        /** Top margin of the All apps title (dp). */
        private const val TOP = 22
        private const val DRAWER_COLS = 6
    }
}


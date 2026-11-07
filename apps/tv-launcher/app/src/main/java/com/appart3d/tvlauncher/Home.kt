package com.appart3d.tvlauncher

import android.graphics.Color
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.roundToInt

/**
 * A light (or a plug driving a lamp) of the home, as the bridge reports it. A ceiling fan with a
 * light is listed too, by its light only (`fanLight`: on / off; its speed stays out of the TV).
 */
data class Lamp(
    val id: String,
    val name: String,
    val room: String,
    val on: Boolean?,
    val reachable: Boolean,
    val color: Int?,
    val fanLight: Boolean = false,
    /** 1..100 for dimmable lights, null otherwise. */
    val brightness: Int? = null,
    /** White temperature in kelvin, when the lamp reports one: how the panel tells a mood is on it. */
    val kelvin: Int? = null,
    /** Ceiling fan: motor speed step 0 (stopped) ..fanSteps, null for lamps. */
    val fanSpeed: Int? = null,
    val fanSteps: Int = 6,
) {
    companion object {
        private val KINDS = setOf("light", "plug")

        fun parse(d: JSONObject): Lamp? {
            val st = d.optJSONObject("state") ?: JSONObject()
            if (d.optString("kind") == "fan" && d.optJSONObject("capabilities")?.optBoolean("fanLight") == true) {
                val steps = d.optJSONObject("capabilities")?.optInt("speedSteps", 6)?.takeIf { it > 0 } ?: 6
                val running = st.optBoolean("on") && st.optInt("speed") > 0
                return Lamp(
                    id = d.getString("id"),
                    name = d.optString("name"),
                    room = d.optString("room"),
                    fanSpeed = if (running) (st.optInt("speed") * steps / 100.0).roundToInt().coerceIn(1, steps) else 0,
                    fanSteps = steps,
                    on = if (st.has("lightOn")) st.optBoolean("lightOn") else null,
                    reachable = st.optBoolean("reachable", true),
                    color = 0xFFFFE2B0.toInt(),
                    fanLight = true,
                )
            }
            if (d.optString("kind") !in KINDS) return null
            val color = st.optString("color").takeIf { it.startsWith("#") }?.let { runCatching { Color.parseColor(it) }.getOrNull() }
            val dimmable = d.optJSONObject("capabilities")?.optBoolean("brightness") == true && st.has("brightness")
            return Lamp(
                id = d.getString("id"),
                name = d.optString("name"),
                room = d.optString("room"),
                on = if (st.isNull("on")) null else st.optBoolean("on"),
                reachable = st.optBoolean("reachable", true),
                color = color,
                brightness = if (dimmable) st.optInt("brightness").coerceIn(1, 100) else null,
                kelvin = if (st.has("kelvin")) st.optInt("kelvin").takeIf { it > 0 } else null,
            )
        }
    }
}

/** A scene of the bridge (Lumineux, Cosy, Film, Nuit, Absent). */
data class Scene(val id: String, val name: String)

/**
 * What a speaker of the home is playing. `where` is the room — the lead one when several play together,
 * and `rooms` says how many — so the card can say where the music is, not only what it is.
 *
 * One of these per *speaker*, and every speaker of a Sonos group carries the same music with the same
 * `where`: that is what lets the details view list the rooms of one group with their own volumes.
 * Transport goes to the group whichever member it is sent to; volume is that room's alone.
 */
data class Playing(
    val id: String,
    /** The speaker's own name (its room), as opposed to `where`, which is the group's lead. */
    val name: String,
    val title: String,
    val artist: String,
    val app: String,
    val where: String,
    val rooms: Int,
    val playing: Boolean,
    /**
     * Nothing is loaded in this room — it is kept only because it *can* be started, so the card has
     * something to offer when the house is silent. `title` and `artist` then name the last source.
     */
    val idle: Boolean,
    /** This room's volume 0..100, null when the speaker does not report one. */
    val volume: Int?,
    /** What the source allows right now: a TV or line-in stream has no transport, radio has no skipping. */
    val canPlayPause: Boolean,
    val canNext: Boolean,
    val canPrevious: Boolean,
) {
    companion object {
        /** True of any speaker, playing or not — so one falling silent can clear the card. */
        fun isSpeaker(d: JSONObject) = d.optString("kind") == "speaker"

        /**
         * What this speaker is playing — or, when it has nothing on, the speaker itself as long as it
         * can be started. Null for an unreachable one, and for a silent one with no transport at all
         * (a TV or line-in input), which would be a dead row.
         */
        fun parse(d: JSONObject): Playing? {
            if (!isSpeaker(d)) return null
            val st = d.optJSONObject("state") ?: return null
            if (!st.optBoolean("reachable", true)) return null
            val m = st.optJSONObject("media") ?: return null
            val state = m.optString("state")
            if (state != "playing" && state != "paused" && state != "idle") return null
            val group = m.optJSONArray("group")
            val app = m.optString("app")
            val caps = d.optJSONObject("capabilities")?.optJSONArray("media")
            val controls = (0 until (caps?.length() ?: 0)).map { caps!!.optString(it) }
            if (state == "idle" && "play" !in controls) return null
            return Playing(
                id = d.getString("id"),
                name = d.optString("name"),
                title = m.optString("title").ifEmpty { app }.ifEmpty { "Playing" },
                artist = m.optString("artist").ifEmpty { app },
                app = app,
                where = group?.optString(0)?.takeIf { it.isNotEmpty() } ?: d.optString("name"),
                rooms = group?.length() ?: 1,
                playing = state == "playing",
                idle = state == "idle",
                volume = if (st.has("volume")) st.optInt("volume").coerceIn(0, 100) else null,
                canPlayPause = "play" in controls || "pause" in controls,
                canNext = "next" in controls,
                canPrevious = "previous" in controls,
            )
        }
    }
}

/**
 * Live lamps from the bridge's event stream (GET /api/home/events: a snapshot, then one event per
 * device change, from any source). Reconnects on its own; callbacks run on the feed thread.
 */
class HomeFeed(
    private val base: String,
    private val token: String,
    private val onLamps: (List<Lamp>) -> Unit,
    private val onLamp: (Lamp) -> Unit,
    /** Solar elevation (degrees) from each snapshot, null when the bridge has none. */
    private val onSun: (Double?) -> Unit = {},
    private val onScenes: (List<Scene>) -> Unit = {},
    /**
     * The mood the bridge holds armed ("relax" / "read"), or null. It lives there, not here, so a press
     * on this panel and a press on the phone cannot leave the house in two states — and only a snapshot
     * carries it, which is why the bridge pushes one whenever it changes.
     */
    private val onMood: (String?) -> Unit = {},
    /** Every speaker with something on, from each snapshot (the others are simply absent). */
    private val onPlaying: (List<Playing>) -> Unit = {},
    /** One speaker changed: what it plays now, or null when it went quiet or out of reach. */
    private val onSpeaker: (String, Playing?) -> Unit = { _, _ -> },
) {
    @Volatile private var running = false
    @Volatile private var conn: HttpURLConnection? = null
    private var thread: Thread? = null

    fun start() {
        if (running) return
        running = true
        thread = Thread(::loop, "home-feed").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running = false
        conn?.disconnect()
        thread?.interrupt()
        thread = null
    }

    private fun loop() {
        while (running) {
            try {
                val c = URL("$base/api/home/events").openConnection() as HttpURLConnection
                conn = c
                c.connectTimeout = 5000
                c.readTimeout = 60_000 // the bridge pings every 25 s
                c.setRequestProperty("authorization", "Bearer $token")
                c.setRequestProperty("accept", "text/event-stream")
                if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
                c.inputStream.bufferedReader().use { r ->
                    val data = StringBuilder()
                    while (running) {
                        val line = r.readLine() ?: break
                        if (line.startsWith("data:")) {
                            data.append(line.substring(5).trimStart())
                        } else if (line.isEmpty() && data.isNotEmpty()) {
                            handle(data.toString())
                            data.setLength(0)
                        }
                    }
                }
            } catch (_: Exception) {
                // Bridge restarting or Wi-Fi hiccup: retry below.
            }
            if (!running) return
            try {
                Thread.sleep(5000)
            } catch (_: InterruptedException) {
                return
            }
        }
    }

    private fun handle(json: String) {
        val ev = runCatching { JSONObject(json) }.getOrNull() ?: return
        when (ev.optString("type")) {
            "snapshot" -> {
                val snapshot = ev.optJSONObject("snapshot") ?: return
                onSun(snapshot.optJSONObject("sun")?.optDouble("elevation")?.takeIf { !it.isNaN() })
                onMood(snapshot.optString("activeScene").takeIf { it.isNotEmpty() && !snapshot.isNull("activeScene") })
                snapshot.optJSONArray("scenes")?.let { a ->
                    onScenes((0 until a.length()).map { a.getJSONObject(it) }.map { Scene(it.getString("id"), it.optString("name")) })
                }
                val devices = snapshot.optJSONArray("devices") ?: return
                val all = (0 until devices.length()).map { devices.getJSONObject(it) }
                onLamps(all.mapNotNull(Lamp::parse))
                onPlaying(all.mapNotNull(Playing::parse))
            }
            "device" -> ev.optJSONObject("device")?.let { d ->
                Lamp.parse(d)?.let(onLamp)
                if (Playing.isSpeaker(d)) onSpeaker(d.optString("id"), Playing.parse(d))
            }
        }
    }

    companion object {
        /** Power (or fanLight for a fan) → the updated lamp. Throws on errors. */
        fun power(base: String, token: String, lamp: Lamp, on: Boolean): Lamp? =
            action(base, token, lamp, JSONObject().put("type", if (lamp.fanLight) "fanLight" else "power").put("on", on))

        /** Brightness 1..100 (the bridge turns the light on) → the updated lamp. Throws on errors. */
        fun brightness(base: String, token: String, lamp: Lamp, value: Int): Lamp? =
            action(base, token, lamp, JSONObject().put("type", "brightness").put("value", value))

        /** Fan motor speed step (0 = stop) → the updated fan. Throws on errors. */
        fun fanSpeed(base: String, token: String, lamp: Lamp, step: Int): Lamp? =
            action(base, token, lamp, JSONObject().put("type", "speed").put("value", if (step <= 0) 0 else (step * 100.0 / lamp.fanSteps).roundToInt()))

        /**
         * Transport on a speaker: "playPause", "next", "previous". The bridge sends it to the group's
         * coordinator, so it acts on every room playing together, whichever member it is addressed to.
         * Throws on errors.
         */
        fun media(base: String, token: String, speaker: Playing, command: String) {
            device(base, token, speaker.id, JSONObject().put("type", "media").put("command", command))
        }

        /** Volume 0..100 of one room (never the group's). Throws on errors. */
        fun volume(base: String, token: String, speaker: Playing, value: Int) {
            device(base, token, speaker.id, JSONObject().put("type", "volume").put("value", value.coerceIn(0, 100)))
        }

        /** POST /api/home/scenes/:id (changes come back through the event stream). Throws on errors. */
        fun scene(base: String, token: String, id: String) {
            post(base, token, "/api/home/scenes/${URLEncoder.encode(id, "UTF-8")}", JSONObject())
        }

        /**
         * Asks the bridge to open the TV's own inputs panel. Fire OS reserves input switching to
         * signed system apps, so the bridge presses KEYCODE_TV_INPUT over ADB instead. Throws on errors.
         */
        fun tvInputs(base: String, token: String) {
            post(base, token, "/api/tv/inputs", JSONObject())
        }

        private fun action(base: String, token: String, lamp: Lamp, action: JSONObject): Lamp? =
            Lamp.parse(device(base, token, lamp.id, action))

        private fun device(base: String, token: String, id: String, action: JSONObject): JSONObject =
            post(base, token, "/api/home/devices/${URLEncoder.encode(id, "UTF-8")}/action", action)

        private fun post(base: String, token: String, path: String, body: JSONObject): JSONObject {
            val c = URL("$base$path").openConnection() as HttpURLConnection
            try {
                c.connectTimeout = 5000
                c.readTimeout = 10_000
                c.requestMethod = "POST"
                c.doOutput = true
                c.setRequestProperty("authorization", "Bearer $token")
                c.setRequestProperty("content-type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
                if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
                return JSONObject(c.inputStream.bufferedReader().use { it.readText() })
            } finally {
                c.disconnect()
            }
        }
    }
}

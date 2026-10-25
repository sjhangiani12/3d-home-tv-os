package com.appart3d.tvlauncher

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.animation.LinearInterpolator
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.sign

/**
 * Lights panel of the Home drawer (paper, ink, pixel type like the block's signs): "Lights" and how many are on,
 * the home's favorite scenes (Relax, Read) and "All off" as small pills, then the lamps that answer — OK toggles, ← / → dims (10 % steps). Lamps the
 * Hue Bridge cannot reach are left out (paired once, never installed). Apple TV look: the focused
 * row or pill turns white with dark text.
 */
class LightsPanel(
    context: Context,
    private val onToggle: (Lamp) -> Unit,
    private val onBrightness: (Lamp, Int) -> Unit,
    private val onFanSpeed: (Lamp, Int) -> Unit,
    /** The selected lamp (null: none), shown in the 3D before it is toggled. */
    private val onSpotlight: (Lamp?) -> Unit,
    private val onScene: (Scene) -> Unit,
    private val onAllOff: () -> Unit,
) : LinearLayout(context) {
    private val subtitle = TextView(context)
    private val pixel: Typeface = runCatching { context.resources.getFont(R.font.pixelify_sans) }.getOrDefault(Typeface.DEFAULT_BOLD)
    private val pills = LinearLayout(context)
    private var sceneIds: List<String> = emptyList()
    private val list = LinearLayout(context)
    private val rows = LinkedHashMap<String, Row>()
    /** Every lamp the bridge reports, shown or not (one can come back within reach). */
    private val all = LinkedHashMap<String, Lamp>()

    init {
        orientation = VERTICAL
        setPadding(dp(2), dp(2), dp(2), dp(2))
        addView(LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(4), dp(4))
            addView(TextView(context).apply {
                text = context.getString(R.string.lights_title)
                setTextColor(INK)
                textSize = 17f
                typeface = pixel
            })
            addView(subtitle.apply {
                setTextColor(MUTED)
                textSize = 12f
                typeface = pixel
            }, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(8) })
        })
        pills.orientation = HORIZONTAL
        pills.clipChildren = false
        pills.setPadding(dp(6), 0, dp(6), dp(4))
        addView(pills)
        setScenes(emptyList())
        list.orientation = VERTICAL
        list.clipChildren = false
        list.clipToPadding = false
        list.setPadding(dp(4), dp(2), dp(4), dp(2))
        addView(ScrollView(context).apply {
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalFadingEdgeEnabled = true
            setFadingEdgeLength(dp(16))
            // Clipped (rows must not scroll over the title); the list padding leaves room for the focus zoom.
            isFocusable = false
            addView(list)
        }, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    }

    /** Only the home's favorites (the bridge's other scenes are the reference app's presets), then "All off". */
    fun setScenes(scenes: List<Scene>) {
        val shown = FAVORITES.mapNotNull { id -> scenes.firstOrNull { it.id == id } }
        if (shown.map { it.id } == sceneIds && pills.childCount > 0) return
        sceneIds = shown.map { it.id }
        pills.removeAllViews()
        for (scene in shown) pills.addView(pill(scene.name) { onScene(scene) })
        pills.addView(pill(context.getString(R.string.all_off), onAllOff))
        for (i in 1 until pills.childCount) (pills.getChildAt(i).layoutParams as LayoutParams).leftMargin = dp(6)
    }

    private fun pill(label: String, onClick: () -> Unit): TextView {
        val pill = TextView(context).apply {
            text = label
            textSize = 12f
            typeface = pixel
            gravity = Gravity.CENTER
            isFocusable = true
            setPadding(dp(10), 0, dp(10), 0)
            setOnClickListener { onClick() }
        }
        val paint = { focused: Boolean ->
            pill.background = GradientDrawable().apply {
                setColor(if (focused) FOCUS else PAPER_2)
                setStroke(dp(1.5f), INK)
            }
            pill.setTextColor(INK)
        }
        paint(false)
        pill.setOnFocusChangeListener { v, f ->
            paint(f)
            v.animate().scaleX(if (f) 1.06f else 1f).scaleY(if (f) 1.06f else 1f).setDuration(140).start()
        }
        pill.layoutParams = LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(26))
        return pill
    }

    fun setLamps(lamps: List<Lamp>) {
        all.clear()
        lamps.forEach { all[it.id] = it }
        render()
    }

    private fun shown(l: Lamp) = l.reachable && l.on != null

    private fun render() {
        val lamps = all.values.filter(::shown)
        if (lamps.map { it.id } != rows.keys.toList()) {
            val focusedId = rows.entries.firstOrNull { it.value.view.hasFocus() }?.key
            list.removeAllViews()
            rows.values.forEach { it.stop() }
            rows.clear()
            for (lamp in lamps) {
                val row = Row(lamp)
                rows[lamp.id] = row
                list.addView(row.view, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)).apply { bottomMargin = dp(2) })
            }
            focusedId?.let { rows[it]?.view?.requestFocus() }
        } else {
            lamps.forEach { rows[it.id]?.bind(it) }
        }
        updateSubtitle()
    }

    /** Current lamps, as shown. */
    fun lamps(): List<Lamp> = rows.values.map { it.lamp }

    fun update(lamp: Lamp) {
        all[lamp.id] = lamp
        // Came within reach or dropped out: the list changes; otherwise only its row.
        if (shown(lamp) != rows.containsKey(lamp.id)) return render()
        rows[lamp.id]?.bind(lamp) ?: return
        updateSubtitle()
    }

    private fun updateSubtitle() {
        val on = rows.values.count { it.lamp.on == true }
        subtitle.text = when {
            rows.isEmpty() -> context.getString(R.string.no_lamp)
            on == 0 -> context.getString(R.string.all_lights_off)
            else -> resources.getQuantityString(R.plurals.lights_on, on, on)
        }
    }

    private inner class Row(var lamp: Lamp) {
        private val dot = ImageView(context).apply {
            setImageResource(R.drawable.ic_bulb)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        private val name = TextView(context)
        private val room = TextView(context)
        private val track = FrameLayout(context)
        /** Brightness of a lit dimmable lamp: a thin bar under its name. */
        private val level = View(context)
        private val levelTrack = FrameLayout(context)
        private val knob = View(context)
        private var focused = false
        /** Fan glyph spinning at a pace that follows the speed step (null while still). */
        private var spinner: ObjectAnimator? = null
        private var spinStep = -1

        val view: LinearLayout = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            setPadding(dp(6), 0, dp(8), 0)
            addView(dot, LayoutParams(dp(22), dp(22)))
            addView(LinearLayout(context).apply {
                orientation = VERTICAL
                addView(name.apply {
                    textSize = 13f
                    typeface = pixel
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
                addView(room.apply {
                    textSize = 10f
                    maxLines = 1
                })
                levelTrack.addView(level, FrameLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT))
                addView(levelTrack, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)).apply { topMargin = dp(2) })
            }, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                leftMargin = dp(8)
                rightMargin = dp(6)
            })
            track.addView(knob, FrameLayout.LayoutParams(dp(12), dp(12), Gravity.CENTER_VERTICAL).apply { leftMargin = dp(2) })
            addView(track, LayoutParams(dp(28), dp(16)))
            setOnClickListener { if (lamp.reachable && lamp.on != null) onToggle(lamp) }
            setOnKeyListener { _, keyCode, event ->
                val step = when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_RIGHT -> 10
                    KeyEvent.KEYCODE_DPAD_LEFT -> -10
                    else -> return@setOnKeyListener false
                }
                lamp.fanSpeed?.let { speed ->
                    // Ceiling fan: ← / → change the motor speed (0 = stopped); OK stays for its light.
                    val next = (speed + step.sign).coerceIn(0, lamp.fanSteps)
                    if (event.action == KeyEvent.ACTION_DOWN && lamp.reachable && next != speed) onFanSpeed(lamp, next)
                    return@setOnKeyListener true
                }
                val b = lamp.brightness ?: return@setOnKeyListener false
                if (event.action == KeyEvent.ACTION_DOWN && lamp.reachable && lamp.on != null) {
                    // Off: → lights it at its last level; on: dims within 1..100 (never switches it off).
                    val next = if (lamp.on != true) (if (step > 0) b else return@setOnKeyListener true) else (b + step).coerceIn(1, 100)
                    onBrightness(lamp, next)
                }
                true
            }
            setOnFocusChangeListener { v, f ->
                focused = f
                v.animate().scaleX(if (f) 1.04f else 1f).scaleY(if (f) 1.04f else 1f).translationZ(if (f) dp(8).toFloat() else 0f).setDuration(160).start()
                paint()
                if (f) onSpotlight(lamp)
                // Left for another row: that row reports itself; left the lamps: nothing selected.
                else v.post { if (rows.values.none { it.view.hasFocus() }) onSpotlight(null) }
            }
        }

        init {
            bind(lamp)
        }

        fun bind(l: Lamp) {
            lamp = l
            name.text = l.name
            dot.setImageResource(if (l.fanSpeed != null) R.drawable.ic_fan else R.drawable.ic_bulb)
            if (l.fanSpeed != null) spin(l.fanSpeed)
            room.text = when {
                !l.reachable || l.on == null -> context.getString(R.string.unreachable)
                l.fanSpeed != null -> if (l.fanSpeed > 0) context.getString(R.string.fan_speed, l.room, l.fanSpeed) else context.getString(R.string.fan_stopped, l.room)
                l.on == true && l.brightness != null -> context.getString(R.string.room_brightness, l.room, l.brightness)
                else -> l.room
            }
            val fraction = when {
                l.fanSpeed != null -> l.fanSpeed.toFloat() / l.fanSteps
                l.on == true && l.brightness != null -> l.brightness / 100f
                else -> 0f
            }
            // The fan keeps an empty bar when stopped: it shows that → speeds it up.
            levelTrack.visibility = if (fraction > 0f || l.fanSpeed != null) View.VISIBLE else View.GONE
            levelTrack.post {
                level.layoutParams = level.layoutParams.apply { width = (levelTrack.width * fraction).toInt() }
            }
            view.alpha = if (l.reachable && l.on != null) 1f else 0.45f
            knob.animate().translationX(if (l.on == true) dp(12).toFloat() else 0f).setDuration(160).start()
            paint()
        }

        fun stop() {
            spinner?.cancel()
            spinner = null
        }

        private fun spin(step: Int) {
            if (step == spinStep) return
            spinStep = step
            spinner?.cancel()
            spinner = null
            if (step <= 0) {
                dot.animate().rotation(0f).setDuration(400).start()
                return
            }
            // One turn in 2 s at speed 1, down to 0.5 s at speed 6.
            val period = (2000 - (step - 1) * 300).toLong()
            spinner = ObjectAnimator.ofFloat(dot, View.ROTATION, dot.rotation % 360f, dot.rotation % 360f + 360f).apply {
                duration = period
                repeatCount = ValueAnimator.INFINITE
                interpolator = LinearInterpolator()
                start()
            }
        }

        /** Paper drawer look: ink on paper; the focused row turns solid ink with paper text. */
        private fun paint() {
            val on = lamp.on == true
            dot.background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(if (on) lamp.color ?: 0xFFFFD27A.toInt() else if (focused) 0x33FBF6EA else 0x1F1C1A24)
            }
            dot.setColorFilter(if (on) 0xB3000000.toInt() else if (focused) 0xCCFBF6EA.toInt() else 0x991C1A24.toInt())
            view.background = if (focused) GradientDrawable().apply { setColor(INK) } else null
            name.setTextColor(if (focused) PAPER else INK)
            room.setTextColor(if (focused) 0xB3FBF6EA.toInt() else MUTED)
            levelTrack.background = GradientDrawable().apply { setColor(if (focused) 0x40FBF6EA else 0x261C1A24) }
            level.background = GradientDrawable().apply { setColor(if (focused) PAPER else 0xFFE2A73A.toInt()) }
            track.background = GradientDrawable().apply {
                setColor(if (on) 0xFFF0B542.toInt() else if (focused) 0x66FBF6EA else 0xFFB9B1A0.toInt())
                setStroke(dp(1.5f), if (focused) PAPER else INK)
            }
            knob.background = GradientDrawable().apply { setColor(if (focused) PAPER else INK) }
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun dp(v: Float): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val INK = 0xFF1C1A24.toInt()
        private const val MUTED = 0xFF6A6170.toInt()
        private const val PAPER = 0xFFFBF6EA.toInt()
        private const val PAPER_2 = 0xFFEFE6D2.toInt()
        private const val FOCUS = 0xFFFFD75E.toInt()
        private val FAVORITES = listOf("relax", "read")
    }
}

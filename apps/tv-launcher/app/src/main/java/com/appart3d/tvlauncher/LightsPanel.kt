package com.appart3d.tvlauncher

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
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
import java.text.Normalizer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sign

/**
 * Lights panel of the Home drawer — the same panel the block's drawer and the phone show, drawn in
 * native views: the lamps grouped by room, each room a heading that is also the room's switch, with its
 * own lamps indented under it; Relax and Read as moods that stay armed rather than buttons that fired
 * once; then "All off".
 *
 * A room says its name, what its lamps are doing and one dot per lamp at rest, and swaps the count and
 * the dots for a knob and a per-lamp bar under the remote: focus changes the parts, not only the colour.
 * OK switches whatever is focused — a room, its lamps together — and ← / → dims it in 10 % steps. A lamp
 * the bridge cannot reach keeps its place in its room, dimmed, with an empty cell in the bar.
 *
 * Paper and ink, like the block's signs; the focused row turns solid ink with paper text.
 */
class LightsPanel(
    context: Context,
    private val onToggle: (Lamp) -> Unit,
    private val onBrightness: (Lamp, Int) -> Unit,
    private val onFanSpeed: (Lamp, Int) -> Unit,
    /** The selected lamp (null: none, or a whole room), shown in the 3D before it is toggled. */
    private val onSpotlight: (Lamp?) -> Unit,
    private val onScene: (Scene) -> Unit,
    private val onAllOff: () -> Unit,
) : LinearLayout(context) {
    private val subtitle = TextView(context)
    /** Names and counts: the TV's own sans, like the dock, rather than a face of this panel's own. */
    private val bold: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    private val body: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    private val pills = LinearLayout(context)
    private var scenes: List<Scene> = emptyList()
    private val pillByScene = LinkedHashMap<String, TextView>()
    private val list = LinearLayout(context)
    private val lampRows = LinkedHashMap<String, LampRow>()
    private val roomRows = LinkedHashMap<String, RoomRow>()
    /** Every lamp the bridge reports, in its order. */
    private val all = LinkedHashMap<String, Lamp>()
    private var groups: List<Group> = emptyList()
    /** The mood the bridge holds armed ("relax" / "read"), or null. It is held there, not here. */
    private var mood: String? = null

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
                textSize = 18f
                typeface = bold
            })
            addView(subtitle.apply {
                setTextColor(MUTED)
                textSize = 10f
                typeface = body
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
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

    /** Only the home's moods (the bridge's other scenes are the reference app's presets), then "All off". */
    fun setScenes(scenes: List<Scene>) {
        val shown = MOODS.mapNotNull { id -> scenes.firstOrNull { it.id == id } }
        if (shown == this.scenes && pills.childCount > 0) return
        this.scenes = shown
        pillByScene.clear()
        pills.removeAllViews()
        for (scene in shown) {
            val pill = pill(scene.name) { onScene(scene) }
            pillByScene[scene.id] = pill
            pills.addView(pill)
        }
        pills.addView(pill(context.getString(R.string.all_off), onAllOff))
        for (i in 1 until pills.childCount) (pills.getChildAt(i).layoutParams as LayoutParams).leftMargin = dp(6)
        paintPills()
    }

    /**
     * Which mood the bridge holds armed. Relax and Read are a mode the panel is in, not a press that
     * happened a moment ago: the pill stays marked until it is pressed again, a hollow ring while the
     * mood waits with nothing lit and a filled one once it is on lamps.
     */
    fun setMood(scene: String?) {
        if (scene == mood) return
        mood = scene
        paintPills()
        updateSubtitle()
        for (row in roomRows.values) row.repaint()
        for (row in lampRows.values) row.repaint()
    }

    private fun paintPills() {
        for ((id, pill) in pillByScene) {
            val armed = id == mood
            val live = armed && all.values.any(::inMood)
            pill.setCompoundDrawablesWithIntrinsicBounds(if (armed) ring(live, pill.isFocused) else null, null, null, null)
            pill.compoundDrawablePadding = if (armed) dp(5) else 0
        }
    }

    /** The mark on an armed pill: hollow while the mood waits, filled once lamps carry it. */
    private fun ring(live: Boolean, focused: Boolean): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setSize(dp(6), dp(6))
        setStroke(dp(1.5f), INK)
        setColor(if (live) INK else if (focused) FOCUS else PAPER_2)
    }

    private fun pill(label: String, onClick: () -> Unit): TextView {
        val pill = TextView(context).apply {
            text = label
            textSize = 11f
            typeface = body
            gravity = Gravity.CENTER
            isFocusable = true
            setPadding(dp(9), 0, dp(9), 0)
            setOnClickListener { onClick() }
        }
        val paint = { focused: Boolean ->
            pill.background = GradientDrawable().apply {
                setColor(if (focused) FOCUS else PAPER_2)
                setStroke(dp(1.5f), INK)
                cornerRadius = dp(8).toFloat()
            }
            pill.setTextColor(INK)
        }
        paint(false)
        pill.setOnFocusChangeListener { v, f ->
            paint(f)
            paintPills()
            v.animate().scaleX(if (f) 1.06f else 1f).scaleY(if (f) 1.06f else 1f).setDuration(140).start()
        }
        pill.layoutParams = LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(23))
        return pill
    }

    fun setLamps(lamps: List<Lamp>) {
        all.clear()
        lamps.forEach { all[it.id] = it }
        render()
    }

    /** Current lamps, as the bridge last reported them. */
    fun lamps(): List<Lamp> = all.values.toList()

    fun update(lamp: Lamp) {
        all[lamp.id] = lamp
        render()
    }

    private fun render() {
        val next = group(all.values.toList())
        val sameShape = next.size == groups.size &&
            next.zip(groups).all { (a, b) -> a.room == b.room && a.lamps.map { it.id } == b.lamps.map { it.id } }
        groups = next
        if (sameShape) {
            for (g in groups) {
                roomRows[g.room]?.bind(g)
                for (l in g.lamps) lampRows[l.id]?.bind(l)
            }
        } else {
            rebuild()
        }
        updateSubtitle()
        paintPills()
    }

    /** A room came or went, or a lamp moved: the list is drawn again, keeping whatever had the remote. */
    private fun rebuild() {
        val focusedRoom = roomRows.entries.firstOrNull { it.value.view.hasFocus() }?.key
        val focusedLamp = lampRows.entries.firstOrNull { it.value.view.hasFocus() }?.key
        lampRows.values.forEach { it.stop() }
        lampRows.clear()
        roomRows.clear()
        list.removeAllViews()
        for (g in groups) {
            val room = RoomRow(g)
            roomRows[g.room] = room
            list.addView(room.view, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)))
            // The lamps of the room, indented past a rail: the indent alone says which room they are under.
            val kids = LinearLayout(context).apply {
                orientation = VERTICAL
                clipChildren = false
            }
            for (lamp in g.lamps) {
                val row = LampRow(lamp)
                lampRows[lamp.id] = row
                kids.addView(row.view, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)).apply { topMargin = dp(2) })
            }
            list.addView(LinearLayout(context).apply {
                orientation = HORIZONTAL
                clipChildren = false
                addView(View(context).apply { setBackgroundColor(0x473B3328) }, LayoutParams(dp(1.5f), ViewGroup.LayoutParams.MATCH_PARENT).apply { leftMargin = dp(10) })
                addView(kids, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(12); rightMargin = dp(14) })
            // The gaps are what gives when three rooms have to fit above the music: the rows keep their
            // 36 and 30 dp -- a row you can hit from the sofa is the point -- and the air between them pays.
            }, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(2); bottomMargin = dp(8) })
        }
        focusedLamp?.let { lampRows[it]?.view?.requestFocus() } ?: focusedRoom?.let { roomRows[it]?.view?.requestFocus() }
    }

    /**
     * What is true right now, in words: "3 on · Relax on 2 of 3 lit". The armed mood is named here and
     * nowhere else, because a dot on a pill across a room is not a sentence.
     */
    private fun updateSubtitle() {
        val lamps = all.values.toList()
        val lit = lamps.count { it.on == true }
        val base = when {
            lamps.isEmpty() -> context.getString(R.string.no_lamp)
            lit == 0 -> context.getString(R.string.all_lights_off)
            else -> resources.getQuantityString(R.plurals.lights_on, lit, lit)
        }
        subtitle.text = moodNote(lamps, lit)?.let { "$base · $it" } ?: base
    }

    /** How far the armed mood has got. Same four facts as the block's status line (packages/home/src/lights.ts). */
    private fun moodNote(lamps: List<Lamp>, lit: Int): String? {
        val name = scenes.firstOrNull { it.id == mood }?.name ?: return null
        val inIt = lamps.filter(::inMood)
        val adjusted = inIt.count(::moodAdjusted)
        return when {
            inIt.isEmpty() -> context.getString(R.string.mood_armed, name)
            adjusted > 0 -> context.getString(R.string.mood_adjusted, name, adjusted)
            inIt.size == lit -> name
            else -> context.getString(R.string.mood_partly, name, inIt.size, lit)
        }
    }

    /**
     * A lamp is *in* the armed mood while it carries the mood's white; dimming by hand does not cool a
     * lamp, so one moved afterwards is still in it — `moodAdjusted` is that case. Hue rounds kelvin
     * through mireds, hence the slack.
     */
    private fun inMood(l: Lamp): Boolean {
        val target = MOOD_KELVIN[mood] ?: return false
        val k = l.kelvin ?: return false
        return l.on == true && abs(k - target) <= 75
    }

    private fun moodAdjusted(l: Lamp): Boolean {
        val target = MOOD_BRIGHTNESS[mood] ?: return false
        return inMood(l) && abs((l.brightness ?: 100) - target) > 2
    }

    /* ----------------------------------------------------------------- rooms */

    /** A room of the panel: the lamps that share its name, in the order the bridge lists them. */
    private class Group(val room: String, val label: String, val lamps: List<Lamp>) {
        val on = lamps.count { it.on == true }
        val reachable = lamps.count { it.reachable && it.on != null }
        /** The three positions of the knob: nothing lit, some lit, every lamp that answers lit. */
        val position: Int = if (on == 0) 0 else if (reachable > 0 && on == reachable) 2 else 1
    }

    /**
     * The lamps grouped by room, in the usual running order, then alphabetically. Rooms are named by the
     * home's own config — French in this one — so the labels are translated for the screen only; a room
     * the home names itself ("Arvindh's room") passes straight through, which is the point.
     */
    private fun group(lamps: List<Lamp>): List<Group> {
        val byRoom = LinkedHashMap<String, MutableList<Lamp>>()
        for (l in lamps) byRoom.getOrPut(l.room.ifEmpty { "Other" }) { mutableListOf() }.add(l)
        return byRoom.map { (room, ls) -> Group(room, roomLabel(room), ls) }
            .sortedWith(compareBy({ ROOM_ORDER.indexOf(it.label).takeIf { i -> i >= 0 } ?: ROOM_ORDER.size }, { it.label }))
    }

    private fun roomLabel(room: String): String {
        val folded = Normalizer.normalize(room.trim().lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")
        return ROOM_LABELS[folded] ?: room
    }

    /** "2 of 3 on", never a percentage: one number for several brightnesses would be a lie. */
    private fun roomCount(g: Group): String {
        val away = g.lamps.size - g.reachable
        val on = if (g.on > 0) context.getString(R.string.room_on_count, g.on, g.lamps.size) else context.getString(R.string.room_off)
        return if (away > 0) context.getString(R.string.room_away, on, away) else on
    }

    /**
     * One cell per lamp, in the order of the rows directly beneath — so the bar on a room row is a legend
     * for its children rather than one number standing in for all of them. A lamp that stopped answering
     * keeps an empty outlined cell: its place in the room is a fact even when its level is not. A lamp at
     * 1 % must not read as off, so the fill has a floor the eye can still see.
     */
    private inner class SegBar(context: Context) : View(context) {
        var lamps: List<Lamp> = emptyList()
            set(v) {
                field = v
                invalidate()
            }
        /** Its row is focused, so it draws paper on ink instead of ink on paper. */
        var onInk = false
            set(v) {
                if (field == v) return
                field = v
                invalidate()
            }
        private val p = Paint(Paint.ANTI_ALIAS_FLAG)

        override fun onDraw(canvas: Canvas) {
            if (lamps.isEmpty() || width <= 0) return
            val gap = dp(1.5f).toFloat()
            val cell = (width - gap * (lamps.size - 1)) / lamps.size
            val h = height.toFloat()
            var x = 0f
            for (l in lamps) {
                if (!l.reachable || l.on == null) {
                    p.style = Paint.Style.STROKE
                    p.strokeWidth = dp(1).toFloat()
                    p.color = if (onInk) 0x59FBF6EA else 0x593B3328
                    canvas.drawRect(x + 0.5f, 0.5f, x + cell - 0.5f, h - 0.5f, p)
                    p.style = Paint.Style.FILL
                } else {
                    p.color = if (onInk) 0x40FBF6EA else 0x261C1A24
                    canvas.drawRect(x, 0f, x + cell, h, p)
                    val fill = level(l)
                    if (fill > 0) {
                        p.color = if (inMood(l)) WARM else if (onInk) PAPER else AMBER
                        canvas.drawRect(x, 0f, x + cell * max(14, fill) / 100f, h, p)
                    }
                    // Where the mood put it, on a lamp moved by hand since: the gap is the whole point.
                    if (moodAdjusted(l)) {
                        p.color = if (onInk) PAPER else INK
                        val at = x + cell * (MOOD_BRIGHTNESS[mood] ?: 100) / 100f
                        canvas.drawRect(at - dp(1).toFloat(), -dp(1.5f).toFloat(), at + dp(1).toFloat(), h + dp(1.5f), p)
                    }
                }
                x += cell + gap
            }
        }
    }

    private fun level(l: Lamp): Int = when {
        l.fanSpeed != null -> l.fanSpeed * 100 / max(1, l.fanSteps)
        l.on != true -> 0
        else -> l.brightness ?: 100
    }

    /**
     * A room row: its name and what its lamps are doing, and the room's own switch. One press puts the
     * whole room out, or brings up every lamp that answers; ← / → moves the lamps that are already lit —
     * it is a level control, not a second way to switch a room on.
     */
    private inner class RoomRow(var group: Group) {
        private val name = TextView(context)
        private val count = TextView(context)
        private val pips = LinearLayout(context)
        private val knob = FrameLayout(context)
        private val handle = View(context)
        private val bars = SegBar(context)
        private var focused = false

        val view: LinearLayout = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            setPadding(dp(7), dp(5), dp(7), dp(5))
            addView(LinearLayout(context).apply {
                orientation = VERTICAL
                addView(name.apply {
                    textSize = 15f
                    typeface = bold
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
                addView(bars, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4)).apply { topMargin = dp(4) })
            }, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(count.apply {
                textSize = 10f
                typeface = body
                maxLines = 1
            }, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(7) })
            addView(pips.apply {
                orientation = HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }, LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(7) })
            knob.addView(handle, FrameLayout.LayoutParams(dp(9), dp(9), Gravity.CENTER_VERTICAL).apply { leftMargin = dp(2) })
            addView(knob, LayoutParams(dp(30), dp(16)).apply { leftMargin = dp(7) })
            setOnClickListener { press() }
            setOnKeyListener { _, keyCode, event ->
                val step = when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_RIGHT -> 10
                    KeyEvent.KEYCODE_DPAD_LEFT -> -10
                    else -> return@setOnKeyListener false
                }
                if (event.action == KeyEvent.ACTION_DOWN) dim(step)
                true
            }
            setOnFocusChangeListener { v, f ->
                focused = f
                v.animate().scaleX(if (f) 1.03f else 1f).scaleY(if (f) 1.03f else 1f).translationZ(if (f) dp(8).toFloat() else 0f).setDuration(160).start()
                paint()
                // A room is several lamps: the 3D view can outline one, so a room outlines none. The
                // indent under the heading is what says which lamps it stands for.
                if (f) onSpotlight(null)
            }
        }

        init {
            bind(group)
        }

        /**
         * A room press is its lamps pressed together: lit ones go off, otherwise every lamp that answers
         * comes on. There is no room device on the bridge — a room is a name several lamps share — so it
         * is one press each, and a lamp coming on under an armed mood is re-toned by the bridge exactly
         * as it would be from a single press.
         */
        private fun press() {
            val lamps = group.lamps.filter { it.reachable && it.on != null }
            val on = lamps.none { it.on == true }
            lamps.filter { (it.on == true) != on }.forEach(onToggle)
        }

        private fun dim(step: Int) {
            for (l in group.lamps) {
                if (l.on != true || !l.reachable) continue
                val speed = l.fanSpeed
                if (speed != null) {
                    val next = (speed + step.sign).coerceIn(0, l.fanSteps)
                    if (next != speed) onFanSpeed(l, next)
                    continue
                }
                val b = l.brightness ?: continue
                onBrightness(l, (b + step).coerceIn(1, 100))
            }
        }

        fun bind(g: Group) {
            group = g
            name.text = g.label
            count.text = roomCount(g)
            if (pips.childCount != g.lamps.size) {
                pips.removeAllViews()
                repeat(g.lamps.size) {
                    pips.addView(View(context), LayoutParams(dp(8), dp(8)).apply { leftMargin = if (pips.childCount == 0) 0 else dp(4) })
                }
            }
            bars.lamps = g.lamps
            handle.animate().translationX(dp(7).toFloat() * g.position).setDuration(160).start()
            paint()
        }

        fun repaint() {
            bars.invalidate()
            paint()
        }

        private fun paint() {
            view.background = if (focused) GradientDrawable().apply { setColor(INK); cornerRadius = dp(5).toFloat() }
            else GradientDrawable().apply {
                setColor(PAPER_2)
                setStroke(dp(1), INK)
                cornerRadius = dp(5).toFloat()
            }
            name.setTextColor(if (focused) PAPER else INK)
            count.setTextColor(if (focused) 0xB3FBF6EA.toInt() else MUTED)
            bars.onInk = focused
            // Focus swaps the parts: the count and the dots leave, the knob and the per-lamp bar take
            // their place. That is what makes a mis-press visible before it is a press.
            count.visibility = if (focused) View.GONE else View.VISIBLE
            pips.visibility = if (focused) View.GONE else View.VISIBLE
            knob.visibility = if (focused) View.VISIBLE else View.GONE
            bars.visibility = if (focused) View.VISIBLE else View.GONE
            for ((i, lamp) in group.lamps.withIndex()) {
                val pip = pips.getChildAt(i) ?: continue
                pip.background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setStroke(dp(1), if (focused) PAPER else INK)
                    setColor(if (lamp.on != true) 0 else if (inMood(lamp)) WARM else AMBER)
                }
                pip.alpha = if (lamp.reachable && lamp.on != null) 1f else 0.4f
            }
            knob.background = GradientDrawable().apply {
                setColor(if (group.position == 2) 0xFFF0B542.toInt() else if (group.position == 1) WARM else 0xFFB9B1A0.toInt())
                setStroke(dp(1.5f), if (focused) PAPER else INK)
                cornerRadius = dp(5).toFloat()
            }
            handle.background = GradientDrawable().apply { setColor(if (focused) PAPER else INK) }
        }
    }

    /**
     * A lamp of a room: its glyph, its name, its switch, and its own level under it. The room is the
     * heading above, so the row does not repeat it.
     */
    private inner class LampRow(var lamp: Lamp) {
        private val dot = ImageView(context).apply {
            setImageResource(R.drawable.ic_bulb)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        private val name = TextView(context)
        private val track = FrameLayout(context)
        private val knob = View(context)
        private val bars = SegBar(context)
        private var focused = false
        /** Fan glyph spinning at a pace that follows the speed step (null while still). */
        private var spinner: ObjectAnimator? = null
        private var spinStep = -1

        val view: LinearLayout = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            setPadding(dp(6), dp(4), dp(6), dp(4))
            addView(dot, LayoutParams(dp(18), dp(18)))
            addView(LinearLayout(context).apply {
                orientation = VERTICAL
                addView(name.apply {
                    textSize = 11f
                    typeface = body
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
                addView(bars, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)).apply { topMargin = dp(3) })
            }, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                leftMargin = dp(7)
                rightMargin = dp(6)
            })
            track.addView(knob, FrameLayout.LayoutParams(dp(8), dp(8), Gravity.CENTER_VERTICAL).apply { leftMargin = dp(2) })
            addView(track, LayoutParams(dp(26), dp(14)))
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
                else v.post { if (lampRows.values.none { it.view.hasFocus() } && roomRows.values.none { it.view.hasFocus() }) onSpotlight(null) }
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
            bars.lamps = listOf(l)
            // The fan keeps an empty bar when stopped: it shows that → speeds it up.
            bars.visibility = if (level(l) > 0 || l.fanSpeed != null) View.VISIBLE else View.INVISIBLE
            view.alpha = if (l.reachable && l.on != null) 1f else 0.45f
            knob.animate().translationX(if (l.on == true) dp(10).toFloat() else 0f).setDuration(160).start()
            paint()
        }

        fun repaint() {
            bars.invalidate()
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

        private fun paint() {
            val on = lamp.on == true
            dot.background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(if (on) lamp.color ?: 0xFFFFD27A.toInt() else if (focused) 0x33FBF6EA else 0x1F1C1A24)
            }
            dot.setColorFilter(if (on) 0xB3000000.toInt() else if (focused) 0xCCFBF6EA.toInt() else 0x991C1A24.toInt())
            view.background = if (focused) GradientDrawable().apply { setColor(INK); cornerRadius = dp(5).toFloat() } else null
            name.setTextColor(if (focused) PAPER else INK)
            bars.onInk = focused
            track.background = GradientDrawable().apply {
                setColor(if (on) 0xFFF0B542.toInt() else if (focused) 0x66FBF6EA else 0xFFB9B1A0.toInt())
                setStroke(dp(1.5f), if (focused) PAPER else INK)
                cornerRadius = dp(5).toFloat()
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
        private const val AMBER = 0xFFE2A73A.toInt()
        private const val WARM = 0xFFFFCF7A.toInt()

        /** The scenes that stay armed, and Philips Hue's own recipes for them — see packages/home/src/lights.ts. */
        private val MOODS = listOf("relax", "read")
        private val MOOD_KELVIN = mapOf("relax" to 2237, "read" to 2890)
        private val MOOD_BRIGHTNESS = mapOf("relax" to 57, "read" to 100)

        /** Bridge rooms are configured in French in this home; shown in English, like the web panels. */
        private val ROOM_LABELS = mapOf(
            "salon" to "Living room", "sejour" to "Living room", "cuisine" to "Kitchen",
            "chambre" to "Bedroom", "bureau" to "Office", "salle de bain" to "Bathroom",
            "salle de bains" to "Bathroom", "salle a manger" to "Dining room",
            "entree" to "Hallway", "couloir" to "Hallway", "wc" to "Toilet", "autre" to "Other",
        )
        private val ROOM_ORDER = listOf("Living room", "Kitchen", "Bedroom", "Office", "Bathroom", "Hallway")
    }
}

package com.appart3d.tvlauncher

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The rooms one piece of music is playing in, and how loud each of them is — the details behind the
 * now-playing card. Same paper-and-ink look as the lamps, and the same manners: ← / → change the volume
 * of the focused room in 5 % steps, Back returns to the card. Volume is per room even though the music is
 * shared, which is the whole reason this view exists: the kitchen can be quiet while the living room is not.
 */
class SpeakersPanel(
    context: Context,
    private val onVolume: (Playing, Int) -> Unit,
) : LinearLayout(context) {
    private val bold: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    private val body: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    private val heading = TextView(context)
    private val list = LinearLayout(context)
    private val rows = LinkedHashMap<String, Row>()

    init {
        orientation = VERTICAL
        setPadding(dp(2), dp(2), dp(2), dp(2))
        addView(heading.apply {
            setTextColor(INK)
            textSize = 17f
            typeface = bold
            setPadding(dp(8), 0, dp(4), dp(6))
        })
        list.orientation = VERTICAL
        list.clipChildren = false
        list.clipToPadding = false
        list.setPadding(dp(4), dp(2), dp(4), dp(2))
        addView(ScrollView(context).apply {
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            isFocusable = false
            addView(list)
        }, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    }

    /** The speakers of one group, lead first. Rebuilt only when the rooms change, so focus survives a volume event. */
    fun setSpeakers(title: String, speakers: List<Playing>) {
        heading.text = title
        if (speakers.map { it.id } != rows.keys.toList()) {
            val focusedId = rows.entries.firstOrNull { it.value.view.hasFocus() }?.key
            list.removeAllViews()
            rows.clear()
            for (s in speakers) {
                val row = Row(s)
                rows[s.id] = row
                list.addView(row.view, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(36)).apply { bottomMargin = dp(2) })
            }
            focusedId?.let { rows[it]?.view?.requestFocus() }
        } else {
            speakers.forEach { rows[it.id]?.bind(it) }
        }
    }

    fun isEmpty() = rows.isEmpty()

    /** Hands the remote to the first room, so the view is usable the moment it appears. */
    fun focusFirst(): Boolean = list.getChildAt(0)?.requestFocus() == true

    private inner class Row(var speaker: Playing) {
        private val name = TextView(context)
        private val level = TextView(context)
        private val bar = View(context)
        private val barTrack = FrameLayout(context)
        private var focused = false

        val view: LinearLayout = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            setPadding(dp(8), 0, dp(8), 0)
            addView(LinearLayout(context).apply {
                orientation = VERTICAL
                addView(name.apply {
                    textSize = 13f
                    typeface = bold
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
                barTrack.addView(bar, FrameLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT))
                addView(barTrack, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)).apply { topMargin = dp(4) })
            }, LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = dp(8) })
            addView(level.apply {
                textSize = 11f
                typeface = body
            })
            setOnKeyListener { _, keyCode, event ->
                val step = when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_RIGHT -> 5
                    KeyEvent.KEYCODE_DPAD_LEFT -> -5
                    else -> return@setOnKeyListener false
                }
                val v = speaker.volume ?: return@setOnKeyListener false
                if (event.action == KeyEvent.ACTION_DOWN) onVolume(speaker, (v + step).coerceIn(0, 100))
                true
            }
            setOnFocusChangeListener { v, f ->
                focused = f
                v.animate().scaleX(if (f) 1.04f else 1f).scaleY(if (f) 1.04f else 1f).translationZ(if (f) dp(8).toFloat() else 0f).setDuration(160).start()
                paint()
            }
        }

        init {
            bind(speaker)
        }

        fun bind(s: Playing) {
            speaker = s
            // The lead room is where the music is from; the rest joined it.
            name.text = if (s.name == s.where) context.getString(R.string.speaker_lead, s.name) else s.name
            level.text = s.volume?.let { context.getString(R.string.volume_percent, it) } ?: "—"
            val fraction = (s.volume ?: 0) / 100f
            barTrack.post { bar.layoutParams = bar.layoutParams.apply { width = (barTrack.width * fraction).toInt() } }
            paint()
        }

        private fun paint() {
            view.background = if (focused) GradientDrawable().apply { setColor(INK) } else null
            name.setTextColor(if (focused) PAPER else INK)
            level.setTextColor(if (focused) 0xB3FBF6EA.toInt() else MUTED)
            barTrack.background = GradientDrawable().apply { setColor(if (focused) 0x40FBF6EA else 0x261C1A24) }
            bar.background = GradientDrawable().apply { setColor(if (focused) PAPER else 0xFFE2A73A.toInt()) }
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val INK = 0xFF1C1A24.toInt()
        private const val MUTED = 0xFF6A6170.toInt()
        private const val PAPER = 0xFFFBF6EA.toInt()
    }
}

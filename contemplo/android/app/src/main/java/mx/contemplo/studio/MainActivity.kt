package mx.contemplo.studio

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.TextureView
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout

/** Full-screen projection surface. Nothing is drawn over the video during normal playback. */
@OptIn(UnstableApi::class)
class MainActivity : Activity() {
    private lateinit var app: App
    private lateinit var idle: LinearLayout
    private lateinit var title: TextView
    private lateinit var line1: TextView
    private lateinit var code: TextView
    private lateinit var line2: TextView
    private lateinit var diag: TextView
    private lateinit var ident: TextView
    private var diagUntil = 0L

    companion object { private var restored = false }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = application as App
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val mp = FrameLayout.LayoutParams.MATCH_PARENT
        val frames = Array(2) { AspectRatioFrameLayout(this) }
        val textures = Array(2) { TextureView(this) }
        for (i in 0..1) {
            frames[i].addView(textures[i], FrameLayout.LayoutParams(mp, mp))
            root.addView(frames[i], FrameLayout.LayoutParams(mp, mp, Gravity.CENTER))
        }
        val black = View(this).apply { setBackgroundColor(Color.BLACK) }
        root.addView(black, FrameLayout.LayoutParams(mp, mp))

        idle = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(Color.BLACK) }
        fun tv(size: Float, color: Int, bold: Boolean = false, spacing: Float = 0f) = TextView(this).apply {
            textSize = size; setTextColor(color); gravity = Gravity.CENTER; letterSpacing = spacing
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT; setPadding(0, 10, 0, 10)
        }
        title = tv(34f, 0xFFECE6DA.toInt(), true, 0.3f).apply { text = "CONTEMPLO STUDIO" }
        line1 = tv(20f, 0xFF8F8A80.toInt())
        code = tv(72f, 0xFFC9A45C.toInt(), true, 0.25f).apply { typeface = Typeface.MONOSPACE }
        line2 = tv(16f, 0xFF8F8A80.toInt())
        listOf(title, line1, code, line2).forEach { idle.addView(it) }
        root.addView(idle, FrameLayout.LayoutParams(mp, mp))

        ident = tv(64f, Color.WHITE, true, 0.1f).apply { setBackgroundColor(0xCC000000.toInt()); visibility = View.GONE }
        root.addView(ident, FrameLayout.LayoutParams(mp, mp))
        diag = TextView(this).apply { textSize = 13f; setTextColor(Color.WHITE); typeface = Typeface.MONOSPACE; setBackgroundColor(0xDD000000.toInt()); setPadding(24, 18, 24, 18); visibility = View.GONE }
        root.addView(diag, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START).apply { setMargins(40, 40, 40, 40) })

        setContentView(root)
        app.engine.attach(frames, textures, black)
        app.engine.identify = { name -> ident.text = "$name\n${Cloud.lanIp()}:${LanServer.PORT}"; ident.visibility = View.VISIBLE; ident.bringToFront(); ident.postDelayed({ ident.visibility = View.GONE }, 5000) }
        app.uiListener = { render() }
        if (!restored) { restored = true; app.engine.restore() }
        render()
        tick()
    }

    private fun tick() { idle.postDelayed({ render(); tick() }, 2000) }

    private fun render() {
        val p = app.prefs
        val showIdle = !p.paired || (!app.engine.hasProgram && !app.engine.playedSinceBoot)
        idle.visibility = if (showIdle) View.VISIBLE else View.GONE
        if (showIdle) {
            idle.bringToFront()
            if (!p.paired) {
                line1.text = "Vincula esta pantalla con tu dashboard."
                code.text = app.cloud.pairCode.ifEmpty { "······" }
                line2.text = if (app.cloud.pairCode.isEmpty()) "Conectando con Contemplo Studio…" else "apps.dosbuhos.com/contemplo  →  Pantallas  →  escribe este código"
            } else {
                val cat = p.catalogList(); val ready = cat.count { app.store.isReady(it.optString("id")) }
                line1.text = "${p.deviceName} · lista para proyectar"
                code.text = ""
                line2.text = "Control en vivo (Wi-Fi):  http://${Cloud.lanIp()}:${LanServer.PORT}\n$ready de ${cat.size} videos listos · ${if (app.cloud.online) "nube conectada" else "sin internet (la proyección no lo necesita)"}"
            }
        }
        if (diag.visibility == View.VISIBLE) {
            if (System.currentTimeMillis() > diagUntil) diag.visibility = View.GONE
            else {
                val st = app.engine.state(); val sto = app.store.storage()
                diag.text = "Contemplo Studio ${BuildConfig.VERSION_NAME}\n${p.deviceName}  ·  ${if (p.paired) "vinculada" else "sin vincular"}\n" +
                    "Wi-Fi: http://${Cloud.lanIp()}:${LanServer.PORT}   PIN: ${p.showPin.ifEmpty { "—" }}\n" +
                    "Nube: ${if (app.cloud.online) "en línea" else "sin conexión"}\n" +
                    "Transición: ${if (app.engine.dual) "doble decodificador" else "un decodificador (corte breve)"}\n" +
                    "Estado: ${st.optString("mode")}${if (st.optBoolean("blackout")) " · NEGRO" else ""}\n" +
                    "Libre: ${sto.optLong("free") / 1_000_000_000.0} GB de ${sto.optLong("total") / 1_000_000_000.0} GB\n" +
                    (st.optString("last_error").takeIf { it.isNotEmpty() }?.let { "Error: $it" } ?: "")
                diag.bringToFront()
            }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            // Remote buttons show a diagnostics box for 20 s (staff troubleshooting only; never needed to operate).
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                diag.visibility = View.VISIBLE; diagUntil = System.currentTimeMillis() + 20_000; render(); return true
            }
            KeyEvent.KEYCODE_BACK -> if (app.engine.hasProgram) return true   // don't leave the show by accident
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { app.engine.command("toggle_pause", org.json.JSONObject()) { _, _ -> }; return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }
    @Suppress("DEPRECATION")
    private fun immersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let { it.hide(WindowInsets.Type.systemBars()); it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE }
        } else window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
    }

    override fun onDestroy() {
        app.uiListener = null; app.engine.identify = null
        app.engine.detach()
        super.onDestroy()
    }
}

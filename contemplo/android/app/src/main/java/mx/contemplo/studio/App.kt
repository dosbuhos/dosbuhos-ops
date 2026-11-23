package mx.contemplo.studio

import android.app.Application
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Owns the long-lived pieces so playback, sync and the LAN server survive the activity being recreated. */
class App : Application() {
    lateinit var prefs: Prefs; lateinit var store: MediaStore; lateinit var engine: Engine; lateinit var cloud: Cloud; lateinit var lan: LanServer
    val main = Handler(Looper.getMainLooper())
    var uiListener: (() -> Unit)? = null

    override fun onCreate() {
        super.onCreate()
        val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).retryOnConnectionFailure(true).build()
        prefs = Prefs(this)
        cloud = Cloud(this, http)
        store = MediaStore(this, http) { k, d -> cloud.event(k, d) }
        engine = Engine(this, store, prefs) { k, d -> cloud.event(k, d) }
        engine.onUi = { ui() }
        lan = LanServer(this)
        try { lan.start(fi.iki.elonen.NanoHTTPD.SOCKET_READ_TIMEOUT, false) } catch (e: Exception) { cloud.event("lan.error", e.message ?: "") }
        cloud.start()
        cloud.event("app.start", BuildConfig.VERSION_NAME + if (engine.dual) " · doble decodificador" else " · un decodificador")
    }

    fun ui() = main.post { uiListener?.invoke() }

    /** Run on the main thread and wait for the result (null on timeout). */
    fun <T> onMain(timeoutMs: Long = 3000, f: () -> T): T? {
        if (Looper.myLooper() == Looper.getMainLooper()) return f()
        val latch = CountDownLatch(1); var r: T? = null
        main.post { try { r = f() } finally { latch.countDown() } }
        return if (latch.await(timeoutMs, TimeUnit.MILLISECONDS)) r else null
    }
}

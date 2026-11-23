package mx.contemplo.studio

import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The live show-control server on the local network: http://<tv>:8320/. Serves the same show page as the dashboard
 * (bundled in assets/web), the player state, commands, and the local video files for the operator's preview.
 * Works with no internet at all. Access needs the show PIN (set in the dashboard, synced to the TV).
 */
class LanServer(private val app: App) : NanoHTTPD(PORT) {
    companion object { const val PORT = 8320 }
    private val sessions = ConcurrentHashMap<String, Long>()
    private var fails = 0; private var lockedUntil = 0L
    private val rnd = SecureRandom()

    private fun json(o: Any, status: Response.Status = Response.Status.OK): Response =
        newFixedLengthResponse(status, "application/json; charset=utf-8", o.toString()).apply { addHeader("Cache-Control", "no-store") }
    private fun err(status: Response.Status, msg: String) = json(JSONObject().put("error", msg), status)

    override fun serve(s: IHTTPSession): Response = try { route(s) } catch (e: Exception) { err(Response.Status.INTERNAL_ERROR, e.message ?: "error") }

    private fun body(s: IHTTPSession): JSONObject {
        val m = HashMap<String, String>(); s.parseBody(m)
        return try { JSONObject(m["postData"] ?: "{}") } catch (_: Exception) { JSONObject() }
    }
    private fun authed(s: IHTTPSession): Boolean {
        val t = s.headers["x-show-token"] ?: s.parameters["t"]?.firstOrNull() ?: return false
        val exp = sessions[t] ?: return false
        if (exp < System.currentTimeMillis()) { sessions.remove(t); return false }
        return true
    }

    private fun route(s: IHTTPSession): Response {
        val uri = s.uri
        when {
            uri == "/" || uri == "/index.html" -> return asset("show.html")
            uri in setOf("/show.html", "/show.js", "/common.js", "/style.css") -> return asset(uri.drop(1))
            uri == "/api/lan/info" -> return json(JSONObject().put("lan", true).put("name", app.prefs.deviceName).put("version", BuildConfig.VERSION_NAME).put("paired", app.prefs.paired))
            uri == "/api/lan/login" && s.method == Method.POST -> {
                if (System.currentTimeMillis() < lockedUntil) return err(Response.Status.TOO_MANY_REQUESTS, "Demasiados intentos. Espera un minuto.")
                val pin = app.prefs.showPin
                if (pin.isEmpty()) return err(Response.Status.FORBIDDEN, "Esta pantalla aún no tiene PIN: vincúlala en el dashboard")
                if (body(s).optString("pin") != pin) { if (++fails >= 5) { lockedUntil = System.currentTimeMillis() + 60_000; fails = 0 }; return err(Response.Status.UNAUTHORIZED, "PIN incorrecto") }
                fails = 0
                val tok = ByteArray(24).also { rnd.nextBytes(it) }.joinToString("") { "%02x".format(it) }
                sessions[tok] = System.currentTimeMillis() + 7L * 86_400_000
                return json(JSONObject().put("token", tok))
            }
        }
        if (!authed(s)) return err(Response.Status.UNAUTHORIZED, "PIN requerido")
        return when {
            uri == "/api/state" -> json(app.onMain { app.engine.state() } ?: JSONObject())
            uri == "/api/library" -> {
                val vids = JSONArray()
                for (v in app.prefs.catalogList()) {
                    val id = v.optString("id")
                    vids.put(JSONObject(v.toString()).put("ready", app.store.isReady(id)).put("has_thumb", app.store.thumb(id).exists()))
                }
                json(JSONObject().put("videos", vids).put("playlists", JSONArray(app.prefs.playlists)))
            }
            uri == "/api/cmd" && s.method == Method.POST -> {
                val b = body(s); val type = b.optString("type"); val payload = b.optJSONObject("payload") ?: JSONObject()
                val latch = CountDownLatch(1); var ok = false; var msg = ""
                app.main.post { app.engine.command(type, payload) { o, m -> ok = o; msg = m; latch.countDown() } }
                if (!latch.await(6, TimeUnit.SECONDS)) return json(JSONObject().put("status", "failed").put("result", "El reproductor no respondió a tiempo"))
                app.cloud.event("lan.$type", if (ok) "ok" else msg)
                json(JSONObject().put("status", if (ok) "done" else "failed").put("result", msg).put("state", app.onMain { app.engine.state() } ?: JSONObject()))
            }
            uri.startsWith("/media/") -> {
                val id = uri.removePrefix("/media/")
                if (!app.store.isReady(id)) err(Response.Status.NOT_FOUND, "No está en este TV") else file(s, app.store.file(id), "video/mp4")
            }
            uri.startsWith("/thumb/") -> app.store.thumb(uri.removePrefix("/thumb/")).let { if (it.exists()) file(s, it, "image/jpeg") else err(Response.Status.NOT_FOUND, "Sin miniatura") }
            else -> err(Response.Status.NOT_FOUND, "No existe")
        }
    }

    private fun asset(name: String): Response {
        val type = when { name.endsWith(".js") -> "text/javascript; charset=utf-8"; name.endsWith(".css") -> "text/css; charset=utf-8"; else -> "text/html; charset=utf-8" }
        val bytes = app.assets.open("web/$name").use { it.readBytes() }
        return newFixedLengthResponse(Response.Status.OK, type, bytes.inputStream(), bytes.size.toLong()).apply { addHeader("Cache-Control", "no-cache") }
    }

    /** Byte-range file serving so the browser preview can scrub without loading the whole file. */
    private fun file(s: IHTTPSession, f: File, type: String): Response {
        val len = f.length()
        val range = s.headers["range"]
        if (range != null && range.startsWith("bytes=")) {
            val (a, b) = range.removePrefix("bytes=").split("-", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
            var start = a.toLongOrNull() ?: 0L
            var end = b.toLongOrNull() ?: (len - 1)
            if (a.isEmpty() && b.isNotEmpty()) { start = len - (b.toLongOrNull() ?: 0L); end = len - 1 }
            end = minOf(end, len - 1)
            if (start > end || start >= len) return newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, type, "").apply { addHeader("Content-Range", "bytes */$len") }
            val input = FileInputStream(f).apply { channel.position(start) }
            return newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, type, input, end - start + 1).apply {
                addHeader("Content-Range", "bytes $start-$end/$len"); addHeader("Accept-Ranges", "bytes")
            }
        }
        return newFixedLengthResponse(Response.Status.OK, type, FileInputStream(f), len).apply { addHeader("Accept-Ranges", "bytes") }
    }
}

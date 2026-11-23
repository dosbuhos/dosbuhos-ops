package mx.contemplo.studio

import android.content.Context
import android.os.StatFs
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Local copies of the videos. A file is only "ready" once it has been fully downloaded AND its SHA-256 matches the one
 * computed in the browser at upload; until then it is <id>.part and never played. Downloads resume with HTTP Range.
 */
class MediaStore(ctx: Context, private val http: OkHttpClient, private val events: (String, String) -> Unit) {
    data class Status(val state: String, val progress: Double = 0.0, val error: String = "")

    private val dir = File(ctx.filesDir, "media").apply { mkdirs() }
    private val thumbs = File(ctx.filesDir, "thumbs").apply { mkdirs() }
    val status = ConcurrentHashMap<String, Status>()
    private val failedAt = ConcurrentHashMap<String, Long>()
    private val longHttp = http.newBuilder().readTimeout(60, TimeUnit.SECONDS).build()

    fun file(id: String) = File(dir, "$id.mp4")
    fun thumb(id: String) = File(thumbs, "$id.jpg")
    private fun part(id: String) = File(dir, "$id.part")
    private fun okMark(id: String) = File(dir, "$id.ok")
    fun isReady(id: String) = file(id).exists() && okMark(id).exists()

    fun storage(): JSONObject {
        val st = StatFs(dir.path)
        val used = dir.listFiles()?.sumOf { it.length() } ?: 0L
        return JSONObject().put("total", st.totalBytes).put("free", st.availableBytes).put("media", used)
    }

    /** Download whatever is wanted and missing, one file at a time. Called from a background coroutine. */
    fun sync(base: String, token: String, wanted: List<JSONObject>) {
        for (v in wanted) {
            val id = v.optString("id")
            if (isReady(id)) { status[id] = Status("ready", 1.0); fetchThumb(base, token, v); continue }
            val lastFail = failedAt[id]
            if (lastFail != null && System.currentTimeMillis() - lastFail < 120_000) continue
            try {
                download(base, token, v)
                fetchThumb(base, token, v)
                failedAt.remove(id)
                events("sync.ready", v.optString("title"))
            } catch (e: Exception) {
                status[id] = Status("failed", 0.0, e.message ?: "Error")
                failedAt[id] = System.currentTimeMillis()
                events("sync.failed", "${v.optString("title")}: ${e.message}")
            }
        }
    }

    private fun download(base: String, token: String, v: JSONObject) {
        val id = v.optString("id"); val size = v.optLong("size"); val sha = v.optString("sha256")
        val p = part(id)
        if (p.length() > size) p.delete()
        val need = size - p.length() + 300L * 1024 * 1024
        if (StatFs(dir.path).availableBytes < need) throw Exception("Sin espacio: faltan ${(need - StatFs(dir.path).availableBytes) / 1_000_000} MB")
        var attempt = 0
        while (p.length() < size) {
            val from = p.length()
            status[id] = Status("downloading", from.toDouble() / size)
            val req = Request.Builder().url("$base/api/device/media/$id").header("Authorization", "Bearer $token").header("Range", "bytes=$from-").build()
            try {
                longHttp.newCall(req).execute().use { res ->
                    if (res.code == 403) throw Exception("Ya no está asignado a esta pantalla")
                    if (res.code != 206 && res.code != 200) throw Exception("HTTP ${res.code}")
                    val append = res.code == 206
                    val body = res.body ?: throw Exception("Respuesta vacía")
                    FileOutputStream(p, append).use { out ->
                        val buf = ByteArray(256 * 1024); var n: Int; var got = if (append) from else 0L; var lastReport = 0L
                        val input = body.byteStream()
                        while (input.read(buf).also { n = it } > 0) {
                            out.write(buf, 0, n); got += n
                            if (got - lastReport > 4L * 1024 * 1024) { status[id] = Status("downloading", got.toDouble() / size); lastReport = got }
                        }
                    }
                }
                attempt = 0
            } catch (e: Exception) {
                if (e.message?.startsWith("Ya no") == true || ++attempt >= 5) throw e
                Thread.sleep(2000L * attempt)   // network blip: resume from where the file ends
            }
        }
        if (p.length() != size) { p.delete(); throw Exception("Tamaño incorrecto; se descargará de nuevo") }
        status[id] = Status("verifying", 1.0)
        if (sha.isNotEmpty()) {
            val got = sha256(p)
            if (!got.equals(sha, true)) { p.delete(); throw Exception("La verificación SHA-256 no coincide; se descargará de nuevo") }
        }
        val f = file(id)
        if (f.exists()) f.delete()
        if (!p.renameTo(f)) throw Exception("No se pudo guardar el archivo")
        okMark(id).writeText(sha)
        status[id] = Status("ready", 1.0)
    }

    private fun fetchThumb(base: String, token: String, v: JSONObject) {
        val id = v.optString("id")
        if (!v.optBoolean("has_thumb") || thumb(id).exists()) return
        try {
            http.newCall(Request.Builder().url("$base/api/device/thumb/$id").header("Authorization", "Bearer $token").build()).execute().use { r ->
                if (r.isSuccessful) r.body?.bytes()?.let { thumb(id).writeBytes(it) }
            }
        } catch (_: Exception) { }
    }

    /** Delete files no longer wanted, never the ones on screen, cued, or in the playlist that is running. */
    fun cleanup(wantedIds: Set<String>, protect: Set<String>) {
        dir.listFiles()?.forEach { f ->
            val id = f.name.substringBefore('.')
            if (id !in wantedIds && id !in protect) { f.delete(); thumb(id).delete(); status.remove(id) }
        }
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { i -> val b = ByteArray(1 shl 20); var n: Int; while (i.read(b).also { n = it } > 0) md.update(b, 0, n) }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}

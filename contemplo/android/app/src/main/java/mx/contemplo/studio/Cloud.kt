package mx.contemplo.studio

import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * The link to the Cloudflare Worker: pairing, a heartbeat every ~2.5 s (state up; commands, wanted videos and lists down),
 * acknowledgements, and background downloads. If the internet is gone, nothing here touches playback: it just retries.
 */
class Cloud(private val app: App, private val http: OkHttpClient) {
    private val base = BuildConfig.CLOUD_URL
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val JSON_T = "application/json".toMediaType()
    private val acks = ConcurrentLinkedQueue<JSONObject>()
    val events = ConcurrentLinkedQueue<JSONObject>()
    private var syncJob: Job? = null
    @Volatile var online = false; private set
    @Volatile var pairCode = ""; private set
    @Volatile var lastContact = 0L; private set

    fun event(kind: String, detail: String) {
        events.add(JSONObject().put("at", System.currentTimeMillis()).put("kind", kind).put("detail", detail))
        while (events.size > 50) events.poll()
    }

    fun start() = scope.launch {
        while (isActive) {
            try { if (!app.prefs.paired) pair() else heartbeat() }
            catch (e: Exception) { online = false; app.ui() }
            delay(if (online) 2500 else 5000)
        }
    }

    private fun post(path: String, body: JSONObject, auth: Boolean = true): Pair<Int, JSONObject> {
        val rb = Request.Builder().url(base + path).post(body.toString().toRequestBody(JSON_T))
        if (auth) rb.header("Authorization", "Bearer ${app.prefs.token}")
        http.newCall(rb.build()).execute().use { r ->
            val txt = r.body?.string() ?: ""
            return r.code to (try { JSONObject(txt) } catch (_: Exception) { JSONObject() })
        }
    }

    private suspend fun pair() {
        val (c, start) = post("/api/device/pair/start", JSONObject().put("model", "${Build.MANUFACTURER} ${Build.MODEL}"), false)
        if (c != 200) throw Exception("pair start $c")
        online = true; pairCode = start.optString("code"); app.ui()
        val secret = start.optString("secret"); val until = start.optLong("expires_at")
        while (System.currentTimeMillis() < until - 5000) {
            delay(3000)
            val (_, r) = post("/api/device/pair/poll", JSONObject().put("secret", secret), false)
            when (r.optString("status")) {
                "paired" -> {
                    app.prefs.token = r.optString("token"); app.prefs.deviceId = r.optString("device_id"); app.prefs.deviceName = r.optString("name")
                    pairCode = ""; event("paired", r.optString("name")); app.ui(); return
                }
                "expired" -> return
            }
        }
    }

    private fun heartbeat() {
        val state = app.onMain { app.engine.state() } ?: JSONObject()
        val wanted = app.prefs.catalogList()
        val media = JSONArray()
        for (v in wanted) {
            val id = v.optString("id"); val s = app.store.status[id]
            media.put(JSONObject().put("id", id).put("state", s?.state ?: if (app.store.isReady(id)) "ready" else "queued").put("progress", s?.progress ?: 0.0).put("error", s?.error ?: ""))
        }
        val ackArr = JSONArray(); val sent = mutableListOf<JSONObject>()
        while (true) { val a = acks.poll() ?: break; ackArr.put(a); sent += a }
        val evArr = JSONArray(); while (true) { val e = events.poll() ?: break; evArr.put(e) }
        val body = JSONObject().put("state", state).put("storage", app.store.storage()).put("media", media).put("acks", ackArr).put("events", evArr)
            .put("lan_ip", lanIp()).put("lan_port", LanServer.PORT).put("app_version", BuildConfig.VERSION_NAME).put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("last_error", state.optString("last_error"))
        val (code, r) = try { post("/api/device/heartbeat", body) } catch (e: Exception) { sent.forEach { acks.add(it) }; throw e }
        if (code == 401) { app.prefs.unpair(); online = false; event("unpaired", "token rechazado"); app.ui(); return }
        if (code != 200) { sent.forEach { acks.add(it) }; throw Exception("heartbeat $code") }
        online = true; lastContact = System.currentTimeMillis()
        r.optJSONObject("device")?.let { d -> app.prefs.deviceName = d.optString("name", app.prefs.deviceName); app.prefs.showPin = d.optString("show_pin", app.prefs.showPin) }
        val newWanted = r.optJSONArray("wanted") ?: JSONArray()
        app.prefs.catalog = newWanted.toString()
        app.prefs.playlists = (r.optJSONArray("playlists") ?: JSONArray()).toString()
        // Commands: run on the main thread, acknowledge right away (not on the next heartbeat).
        val cmds = r.optJSONArray("commands") ?: JSONArray()
        val serverNow = r.optLong("server_time", System.currentTimeMillis())
        for (i in 0 until cmds.length()) {
            val c = cmds.getJSONObject(i); val id = c.optString("id")
            if (serverNow - c.optLong("created_at", serverNow) > 90_000) { ack(id, false, "Orden vencida, no se ejecutó"); continue }
            val type = c.optString("type")
            if (type == "sync_now") { syncSoon(); ack(id, true, ""); continue }
            app.main.post { app.engine.command(type, c.optJSONObject("payload") ?: JSONObject()) { ok, msg -> ack(id, ok, msg) } }
        }
        syncSoon()
        app.ui()
    }

    private fun ack(id: String, ok: Boolean, msg: String) {
        val a = JSONObject().put("id", id).put("status", if (ok) "done" else "failed").put("result", msg)
        scope.launch {
            try { val (c, _) = post("/api/device/ack", JSONObject().put("acks", JSONArray().put(a))); if (c != 200) acks.add(a) } catch (_: Exception) { acks.add(a) }
        }
    }

    /** Download what is missing, then remove what is no longer assigned (single-flight). */
    fun syncSoon() {
        if (syncJob?.isActive == true) return
        syncJob = scope.launch {
            val wanted = app.prefs.catalogList()
            app.store.sync(base, app.prefs.token, wanted)
            val protect = app.onMain { app.engine.protectedIds() } ?: return@launch   // unknown = don't delete anything
            app.store.cleanup(wanted.map { it.optString("id") }.toSet(), protect)
        }
    }

    companion object {
        fun lanIp(): String = try {
            NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
                .sortedBy { if (it.name.startsWith("eth")) 0 else if (it.name.startsWith("wlan")) 1 else 2 }
                .flatMap { it.inetAddresses.toList() }.firstOrNull { it is Inet4Address && it.isSiteLocalAddress }?.hostAddress ?: ""
        } catch (_: Exception) { "" }
    }
}

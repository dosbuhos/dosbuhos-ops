package mx.contemplo.studio

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Everything the player keeps across restarts. App-private storage; the token never leaves this device except to the Worker. */
class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("contemplo", Context.MODE_PRIVATE)
    private fun s(k: String) = p.getString(k, "") ?: ""
    private fun put(k: String, v: String) = p.edit().putString(k, v).apply()

    var token: String get() = s("token"); set(v) = put("token", v)
    var deviceId: String get() = s("device_id"); set(v) = put("device_id", v)
    var deviceName: String get() = s("device_name").ifEmpty { "Contemplo" }; set(v) = put("device_name", v)
    var showPin: String get() = s("show_pin"); set(v) = put("show_pin", v)
    var fit: String get() = s("fit").ifEmpty { "fit" }; set(v) = put("fit", v)
    var muted: Boolean get() = p.getBoolean("muted", false); set(v) = p.edit().putBoolean("muted", v).apply()
    /** What was on screen, so a reboot or crash resumes it (JSON scene or playlist). Empty = nothing / stopped. */
    var lastProgram: String get() = s("last_program"); set(v) = put("last_program", v)
    /** Videos this device should hold (from the last heartbeat): JSON array of {id,title,size,sha256,duration_ms,...}. */
    var catalog: String get() = s("catalog").ifEmpty { "[]" }; set(v) = put("catalog", v)
    var playlists: String get() = s("playlists").ifEmpty { "[]" }; set(v) = put("playlists", v)

    val paired get() = token.isNotEmpty()

    fun catalogList(): List<JSONObject> = JSONArray(catalog).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    fun video(id: String): JSONObject? = catalogList().firstOrNull { it.optString("id") == id }
    fun playlist(id: String): JSONObject? = JSONArray(playlists).let { a -> (0 until a.length()).map { a.getJSONObject(it) }.firstOrNull { it.optString("id") == id } }

    fun unpair() { p.edit().remove("token").remove("device_id").remove("show_pin").apply() }
}

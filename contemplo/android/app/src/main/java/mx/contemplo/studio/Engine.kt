package mx.contemplo.studio

import android.animation.ValueAnimator
import android.content.Context
import android.media.MediaCodecList
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.TextureView
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import org.json.JSONArray
import org.json.JSONObject

/**
 * Two ExoPlayers stacked on two TextureViews. The "live" one is on the projectors; CUE loads the next scene into the
 * other one, prepared and paused on its first frame, so GO is an immediate cut or a crossfade with no black between.
 * If the hardware cannot run two decoders at once, it falls back to one player (a short cut on GO) and says so.
 * Everything here runs on the main thread.
 */
@OptIn(UnstableApi::class)
class Engine(private val ctx: Context, private val store: MediaStore, private val prefs: Prefs, private val events: (String, String) -> Unit) {
    data class Scene(val videoId: String, val title: String, val durationMs: Long, val playlistId: String, val sceneIndex: Int,
                     val transition: String, val fadeMs: Long, val endAction: String) {
        val loop get() = endAction == "loop"
        fun json(): JSONObject = JSONObject().put("video_id", videoId).put("playlist_id", playlistId).put("scene_index", sceneIndex)
            .put("transition", transition).put("fade_ms", fadeMs).put("end_action", endAction)
    }

    val main = Handler(Looper.getMainLooper())
    private val players = arrayOf(build(0), build(1))
    private var live = 0
    private var frames = arrayOfNulls<AspectRatioFrameLayout>(2)
    private var textures = arrayOfNulls<TextureView>(2)
    private var black: View? = null
    var onUi: (() -> Unit)? = null
    var identify: ((String) -> Unit)? = null

    var dual = probeDual(); private set
    private var program: Scene? = null
    private var ambient: JSONObject? = null        // playlist running as one gapless sequence in the live player
    private var cued: Scene? = null
    private var cuedReady = false
    private var blackout = false
    private var muted = prefs.muted
    private var volume = 1f
    private var lastError = ""
    private var retries = 0
    var playedSinceBoot = false; private set
    private var anim: ValueAnimator? = null

    private fun build(i: Int): ExoPlayer {
        val p = ExoPlayer.Builder(ctx, DefaultRenderersFactory(ctx).setEnableDecoderFallback(true)).build()
        // No audio-focus handling: nothing else on this box may pause the show.
        p.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), false)
        p.addListener(object : Player.Listener {
            override fun onVideoSizeChanged(videoSize: VideoSize) {
                if (videoSize.height > 0) frames[i]?.setAspectRatio(videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height)
            }
            override fun onRenderedFirstFrame() {
                if (i != live && cued != null) { cuedReady = true; onUi?.invoke() }
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (i == live && state == Player.STATE_ENDED) ended()
                if (i == live && state == Player.STATE_READY) retries = 0
            }
            override fun onPlayerError(error: PlaybackException) = playerError(i, error)
        })
        return p
    }

    /** One hardware H.264 decoder able to run two sessions = dual-player mode. Confirmed (or disproved) by the first real CUE. */
    private fun probeDual(): Boolean = try {
        MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
            !info.isEncoder && info.supportedTypes.any { it.equals("video/avc", true) } &&
                !info.name.lowercase().let { it.startsWith("omx.google") || it.startsWith("c2.android") } &&
                info.getCapabilitiesForType("video/avc").maxSupportedInstances >= 2
        }
    } catch (e: Exception) { false }

    // ---------- views ----------
    fun attach(f: Array<AspectRatioFrameLayout>, t: Array<TextureView>, blackView: View) {
        frames = arrayOf(f[0], f[1]); textures = arrayOf(t[0], t[1]); black = blackView
        for (i in 0..1) { players[i].setVideoTextureView(t[i]); applyFit(f[i]) }
        frames[live]?.alpha = 1f; frames[1 - live]?.alpha = 0f
        frames[live]?.bringToFront(); black?.bringToFront()
        black?.alpha = if (blackout || program == null) 1f else 0f
    }
    fun detach() { for (i in 0..1) textures[i]?.let { players[i].clearVideoTextureView(it) }; frames = arrayOfNulls(2); textures = arrayOfNulls(2); black = null }
    private fun applyFit(f: AspectRatioFrameLayout?) { f?.resizeMode = if (prefs.fit == "fill") AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT }

    // ---------- commands ----------
    /** Run one command; [done] is called with (ok, message) once the TV has actually done it. */
    fun command(type: String, a: JSONObject, done: (Boolean, String) -> Unit) {
        try {
            when (type) {
                "play" -> { val s = scene(a.put("end_action", if (a.optBoolean("loop", true)) "loop" else "hold")) ?: return done(false, notReady(a)); cue(s); goWhenReady(s.copy(transition = "cut"), done) }
                "play_playlist" -> playPlaylist(a.optString("playlist_id"), done)
                "cue" -> { val s = scene(a) ?: return done(false, notReady(a)); cue(s); done(true, "En espera") }
                "go" -> {
                    if (a.has("video_id") && (cued == null || cued?.videoId != a.optString("video_id") || cued?.sceneIndex != a.optInt("scene_index", -1))) {
                        val s = scene(a) ?: return done(false, notReady(a)); cue(s)
                    }
                    val c = cued ?: return done(false, "No hay nada en espera (CUE)")
                    goWhenReady(c, done)
                }
                "pause" -> { livePlayer().pause(); done(true, "") }
                "resume" -> { if (program == null && ambient == null) return done(false, "No hay video"); livePlayer().play(); done(true, "") }
                "toggle_pause" -> { if (livePlayer().isPlaying) livePlayer().pause() else livePlayer().play(); done(true, "") }
                "restart" -> {
                    val p = livePlayer(); if (program == null && ambient == null) return done(false, "No hay video")
                    if (ambient != null) p.seekTo(p.currentMediaItemIndex, 0) else p.seekTo(0); p.play(); done(true, "")
                }
                "stop" -> { stop(); done(true, "") }
                "blackout" -> { setBlackout(a.optBoolean("on", !blackout), a.optLong("fade_ms", 500)); done(true, "") }
                "seek" -> { livePlayer().seekTo(a.optLong("position_ms")); done(true, "") }
                "skip" -> skip(a.optInt("dir", 1), done)
                "mute" -> { muted = a.optBoolean("on", !muted); prefs.muted = muted; applyVolume(); done(true, "") }
                "volume" -> { volume = a.optDouble("value", 1.0).toFloat().coerceIn(0f, 1f); applyVolume(); done(true, "") }
                "fit" -> { prefs.fit = if (a.optString("mode") == "fill") "fill" else "fit"; frames.forEach { applyFit(it) }; done(true, "") }
                "loop" -> {
                    val on = a.optBoolean("on", true)
                    if (ambient != null) livePlayer().repeatMode = if (on) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
                    else { livePlayer().repeatMode = if (on) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF; program = program?.copy(endAction = if (on) "loop" else "hold") }
                    persist(); done(true, "")
                }
                "identify" -> { identify?.invoke(prefs.deviceName); done(true, "") }
                else -> done(false, "Orden desconocida: $type")
            }
        } catch (e: Exception) { lastError = e.message ?: e.toString(); done(false, lastError) }
        onUi?.invoke()
    }

    private fun notReady(a: JSONObject) = "El video no está copiado y verificado en este TV (${prefs.video(a.optString("video_id"))?.optString("title") ?: a.optString("video_id")})"

    private fun scene(a: JSONObject): Scene? {
        val id = a.optString("video_id")
        if (!store.isReady(id)) return null
        val v = prefs.video(id)
        return Scene(id, v?.optString("title") ?: id, v?.optLong("duration_ms") ?: 0, a.optString("playlist_id"), a.optInt("scene_index", -1),
            if (a.optString("transition") == "fade") "fade" else "cut", a.optLong("fade_ms", 800).coerceIn(0, 10_000), a.optString("end_action").ifEmpty { "loop" })
    }
    private fun item(id: String) = MediaItem.Builder().setUri(Uri.fromFile(store.file(id))).setMediaId(id).build()
    private fun livePlayer() = players[live]

    private fun cue(s: Scene) {
        cued = s; cuedReady = false
        if (dual) {
            val sb = players[1 - live]
            sb.stop(); sb.clearMediaItems()
            sb.setMediaItem(item(s.videoId)); sb.repeatMode = if (s.loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
            sb.volume = 0f; sb.playWhenReady = false; sb.prepare()
            frames[1 - live]?.alpha = 0f
        } else cuedReady = true   // single decoder: the file is verified; GO loads it into the live player
        onUi?.invoke()
    }

    /** Wait (briefly) for the cued player's first frame so GO never cuts to an empty surface. */
    private fun goWhenReady(s: Scene, done: (Boolean, String) -> Unit, waited: Long = 0) {
        if (cuedReady || waited >= 2500) { go(s); done(true, if (cuedReady || !dual) "" else "Lanzado sin precarga completa") ; onUi?.invoke(); return }
        main.postDelayed({ goWhenReady(s, done, waited + 30) }, 30)
    }

    private fun go(s: Scene) {
        anim?.cancel(); ambient = null
        val wasBlack = blackout
        var dipping = false
        if (dual && cued != null) {
            val old = live; val nw = 1 - live
            val np = players[nw]; val op = players[old]
            np.volume = 0f; np.play()
            frames[nw]?.bringToFront(); black?.bringToFront()
            val target = targetVolume()
            if (s.transition == "fade" && s.fadeMs > 0 && program != null) {
                anim = ValueAnimator.ofFloat(0f, 1f).setDuration(s.fadeMs).apply {
                    addUpdateListener { val f = it.animatedValue as Float; frames[nw]?.alpha = f; np.volume = target * f; op.volume = target * (1 - f) }
                    addListener(object : android.animation.AnimatorListenerAdapter() { override fun onAnimationEnd(animation: android.animation.Animator) { release(op, old) } })
                    start()
                }
            } else {
                frames[nw]?.alpha = 1f; np.volume = target
                main.postDelayed({ release(op, old) }, 80)
            }
            live = nw
        } else {
            // One decoder: load into the live player. With a fade, dip to black first and come back on the first frame.
            val p = livePlayer()
            val load = {
                p.setMediaItem(item(s.videoId)); p.repeatMode = if (s.loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
                p.volume = targetVolume(); p.prepare(); p.play(); frames[live]?.alpha = 1f
            }
            if (s.transition == "fade" && s.fadeMs > 0 && program != null && !blackout) {
                dipping = true
                fadeBlack(1f, s.fadeMs / 2) { load(); main.postDelayed({ if (!blackout) fadeBlack(0f, s.fadeMs / 2) {} }, 120) }
            } else load()
        }
        program = s; cued = null; cuedReady = false; playedSinceBoot = true; lastError = ""
        if (!dipping && (wasBlack || black?.alpha != 0f)) setBlackout(false, if (s.transition == "fade") s.fadeMs else 0)
        persist()
        events("go", s.title)
    }
    private fun release(p: ExoPlayer, idx: Int) { if (idx != live) { p.stop(); p.clearMediaItems(); frames[idx]?.alpha = 0f } }

    private fun playPlaylist(id: String, done: (Boolean, String) -> Unit) {
        val pl = prefs.playlist(id) ?: return done(false, "Lista no encontrada en este TV (aún no se sincroniza)")
        val items = pl.optJSONArray("items") ?: JSONArray()
        val ids = (0 until items.length()).map { items.getJSONObject(it).optString("video_id") }
        if (ids.isEmpty()) return done(false, "La lista está vacía")
        val missing = ids.filterNot { store.isReady(it) }
        // Never switch to a half-copied playlist: what is playing stays until every file is verified.
        if (missing.isNotEmpty()) return done(false, "Faltan ${missing.size} video(s) por copiar; sigue lo que está en pantalla")
        anim?.cancel()
        cued = null; cuedReady = false
        val p = livePlayer()
        players[1 - live].stop(); players[1 - live].clearMediaItems(); frames[1 - live]?.alpha = 0f
        p.setMediaItems(ids.map { item(it) }); p.repeatMode = if (pl.optBoolean("loop", true)) Player.REPEAT_MODE_ALL else Player.REPEAT_MODE_OFF
        p.volume = targetVolume(); p.prepare(); p.play(); frames[live]?.alpha = 1f
        ambient = pl
        val first = prefs.video(ids[0])
        program = Scene(ids[0], first?.optString("title") ?: "", first?.optLong("duration_ms") ?: 0, id, 0, "cut", 0, "next")
        playedSinceBoot = true; lastError = ""
        setBlackout(false, 0); persist(); events("play_playlist", pl.optString("name"))
        done(true, "")
    }

    private fun skip(dir: Int, done: (Boolean, String) -> Unit) {
        val p = livePlayer()
        if (ambient != null) { if (dir > 0) p.seekToNextMediaItem() else p.seekToPreviousMediaItem(); return done(true, "") }
        val pg = program ?: return done(false, "No hay video")
        if (pg.playlistId.isNotEmpty()) {
            val n = nextScene(pg, dir) ?: return done(false, "No hay más escenas")
            cue(n); goWhenReady(n, done); return
        }
        p.seekTo(0); p.play(); done(true, "Sin lista: se reinició")
    }
    private fun nextScene(pg: Scene, dir: Int): Scene? {
        val pl = prefs.playlist(pg.playlistId) ?: return null
        val items = pl.optJSONArray("items") ?: return null
        var i = pg.sceneIndex + dir
        if (i >= items.length()) { if (pl.optBoolean("loop", true)) i = 0 else return null }
        if (i < 0) return null
        val it = items.getJSONObject(i)
        return scene(JSONObject(it.toString()).put("playlist_id", pg.playlistId).put("scene_index", i))
    }

    private fun ended() {
        val pg = program ?: return
        when (pg.endAction) {
            "black" -> setBlackout(true, 800)
            "next" -> { val c = cued; if (c != null) goWhenReady(c, { _, _ -> }) else nextScene(pg, 1)?.let { cue(it); goWhenReady(it, { _, _ -> }) } }
            else -> { }   // hold: ExoPlayer keeps the last frame on the surface
        }
        onUi?.invoke()
    }

    fun stop() {
        anim?.cancel()
        players.forEach { it.stop(); it.clearMediaItems() }
        program = null; ambient = null; cued = null; cuedReady = false
        black?.alpha = 1f; blackout = false
        prefs.lastProgram = ""
        events("stop", "")
    }

    private fun setBlackout(on: Boolean, fadeMs: Long) {
        blackout = on
        fadeBlack(if (on || program == null) 1f else 0f, fadeMs) {}
        applyVolume(fadeMs)
    }
    private fun fadeBlack(to: Float, ms: Long, end: () -> Unit) {
        val b = black ?: return end()
        b.bringToFront()
        b.animate().cancel()
        if (ms <= 0) { b.alpha = to; end() } else b.animate().alpha(to).setDuration(ms).withEndAction(end).start()
    }
    private fun targetVolume() = if (muted || blackout) 0f else volume
    private fun applyVolume(fadeMs: Long = 0) {
        val p = livePlayer(); val to = targetVolume(), from = p.volume
        if (fadeMs <= 0) { p.volume = to; return }
        ValueAnimator.ofFloat(from, to).setDuration(fadeMs).apply { addUpdateListener { p.volume = it.animatedValue as Float }; start() }
    }

    private fun playerError(i: Int, e: PlaybackException) {
        val msg = "${e.errorCodeName}: ${e.message}"
        events("player.error", msg)
        if (i != live) {
            // The standby player could not start next to the live one: this box has one usable decoder.
            if (e.errorCode in 4000..4999 && dual) { dual = false; events("transition.single", "Segundo decodificador no disponible: $msg"); players[i].stop(); cuedReady = cued != null; onUi?.invoke() }
            return
        }
        lastError = msg
        if (retries++ < 3) main.postDelayed({ val p = players[i]; p.prepare(); p.play() }, 1500L * retries)
        else { fadeBlack(1f, 300) {}; onUi?.invoke() }
    }

    private fun persist() {
        val pg = program
        prefs.lastProgram = when {
            ambient != null -> JSONObject().put("kind", "playlist").put("playlist_id", ambient!!.optString("id")).toString()
            pg != null -> JSONObject().put("kind", "scene").put("scene", pg.json()).toString()
            else -> ""
        }
    }

    /** After a reboot, crash or update: put back what was on screen, if its files are still here. */
    fun restore() {
        val s = prefs.lastProgram; if (s.isEmpty() || program != null) return
        try {
            val o = JSONObject(s)
            if (o.optString("kind") == "playlist") playPlaylist(o.optString("playlist_id")) { ok, m -> events("restore", if (ok) "lista" else m) }
            else command("play", o.getJSONObject("scene").put("loop", o.getJSONObject("scene").optString("end_action") == "loop")) { ok, m -> events("restore", if (ok) "escena" else m) }
        } catch (e: Exception) { events("restore", e.message ?: "") }
    }

    /** Media still needed on screen: never deleted by cleanup. */
    fun protectedIds(): Set<String> {
        val out = mutableSetOf<String>()
        program?.let { out += it.videoId }; cued?.let { out += it.videoId }
        ambient?.optJSONArray("items")?.let { a -> for (i in 0 until a.length()) out += a.getJSONObject(i).optString("video_id") }
        return out
    }

    fun state(): JSONObject {
        val p = livePlayer()
        val st = JSONObject()
        val mode = when {
            program == null && ambient == null -> "idle"
            lastError.isNotEmpty() && p.playbackState == Player.STATE_IDLE -> "error"
            p.playbackState == Player.STATE_BUFFERING -> "buffering"
            p.playbackState == Player.STATE_ENDED -> "ended"
            p.isPlaying -> "playing"
            else -> "paused"
        }
        st.put("mode", mode).put("blackout", blackout).put("muted", muted).put("volume", volume.toDouble()).put("fit", prefs.fit)
            .put("transition_mode", if (dual) "dual" else "single").put("at", System.currentTimeMillis())
        if (lastError.isNotEmpty()) st.put("last_error", lastError)
        val pg = program
        if (pg != null) {
            var vid = pg.videoId; var idx = pg.sceneIndex
            if (ambient != null) { vid = p.currentMediaItem?.mediaId ?: vid; idx = p.currentMediaItemIndex }
            val v = prefs.video(vid)
            val dur = p.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: (v?.optLong("duration_ms") ?: pg.durationMs)
            st.put("program", JSONObject().put("video_id", vid).put("title", v?.optString("title") ?: pg.title).put("position_ms", p.currentPosition)
                .put("duration_ms", dur).put("loop", if (ambient != null) p.repeatMode != Player.REPEAT_MODE_OFF else p.repeatMode == Player.REPEAT_MODE_ONE)
                .put("playlist_id", pg.playlistId).put("scene_index", idx).put("end_action", pg.endAction))
        }
        cued?.let { c -> st.put("cued", JSONObject().put("video_id", c.videoId).put("title", c.title).put("ready", cuedReady).put("playlist_id", c.playlistId).put("scene_index", c.sceneIndex)) }
        return st
    }
    val hasProgram get() = program != null || ambient != null
}

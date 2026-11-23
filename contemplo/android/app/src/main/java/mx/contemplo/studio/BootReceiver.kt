package mx.contemplo.studio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * After a reboot or an app update, bring the player back to the front. Android 10+ only allows this when the app holds
 * "display over other apps" (granted once over adb, see docs/INSTALL.md); without it the system silently ignores the
 * start and staff open Contemplo Studio from Apps. The process starting here already restores sync and the LAN server.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        try {
            ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            (ctx.applicationContext as? App)?.cloud?.event("boot", intent.action ?: "")
        } catch (e: Exception) {
            (ctx.applicationContext as? App)?.cloud?.event("boot.blocked", e.message ?: "")
        }
    }
}

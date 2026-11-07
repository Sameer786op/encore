package app.encore.player.playback

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** whether the phone can reach the internet right now, so the player can wait for a connection instead of skipping songs */
class Connectivity(context: Context) {
    private val manager = context.getSystemService(ConnectivityManager::class.java)
    private val _online = MutableStateFlow(check())
    val online: StateFlow<Boolean> = _online

    init {
        manager?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                _online.value = check()
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                _online.value = capabilities.isUsable()
            }

            override fun onLost(network: Network) {
                _online.value = check()
            }
        })
    }

    /** safe from any thread */
    val isOnline: Boolean get() = _online.value

    private fun check(): Boolean {
        val m = manager ?: return true
        val network = m.activeNetwork ?: return false
        return m.getNetworkCapabilities(network)?.isUsable() ?: false
    }

    private fun NetworkCapabilities.isUsable() =
        hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}

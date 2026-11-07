package app.encore.player

import android.app.Application
import android.content.Context
import android.os.StrictMode
import android.telephony.TelephonyManager
import androidx.media3.common.util.UnstableApi
import app.encore.player.data.PageStore
import app.encore.player.data.SearchModel
import app.encore.player.playback.AudioDataSourceFactory
import app.encore.player.playback.Connectivity
import app.encore.player.playback.Playback
import app.encore.player.playback.QueueStore
import app.encore.player.youtube.Catalog
import app.encore.player.youtube.InnerTube
import app.encore.player.youtube.Streams
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import okhttp3.OkHttpClient
import okio.Path.Companion.toOkioPath
import java.io.File
import java.util.Locale
import java.util.concurrent.TimeUnit

/** everything the app shares, made once */
@UnstableApi
class AppGraph(context: Context) {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    val settings = Settings(context)
    val connectivity = Connectivity(context)
    val innerTube = InnerTube(http, fallbackCountry = { phoneCountry(context) })
    val catalog = Catalog(innerTube)
    val streams = Streams(innerTube, http)
    val audioSources = AudioDataSourceFactory(context, streams, http)
    val playback = Playback(QueueStore(File(context.filesDir, "queue.json")), catalog, settings, connectivity)

    // made when the screens first need them, so a headphone button starting the player fetches nothing else
    val pages by lazy { PageStore(catalog, connectivity, context.cacheDir) }
    val search by lazy { SearchModel(catalog, connectivity, settings) }

    private fun phoneCountry(context: Context): String {
        val telephony = context.getSystemService(TelephonyManager::class.java)
        val country = telephony?.networkCountryIso?.takeIf { it.length == 2 } ?: telephony?.simCountryIso?.takeIf { it.length == 2 }
        return (country ?: Locale.getDefault().country).uppercase(Locale.ROOT).ifEmpty { "US" }
    }
}

@UnstableApi
class VyseApp : Application(), SingletonImageLoader.Factory {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            // test builds log any disk or network work on the main thread, and leaks
            StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build())
            StrictMode.setVmPolicy(
                StrictMode.VmPolicy.Builder()
                    .detectLeakedClosableObjects()
                    .detectLeakedSqlLiteObjects()
                    .detectActivityLeaks()
                    .penaltyLog()
                    .build(),
            )
        }
        graph = AppGraph(this)
    }

    // covers are cached on disk and in memory, fetched over the app's one connection pool
    override fun newImageLoader(context: Context): ImageLoader = ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { graph.http })) }
        .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.2).build() }
        .diskCache { DiskCache.Builder().directory(File(context.cacheDir, "covers").toOkioPath()).maxSizeBytes(200L * 1024 * 1024).build() }
        .crossfade(180)
        .build()
}

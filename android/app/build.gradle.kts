import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// The phone app carries the desktop app's version number, so a release names both the same.
val desktopVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootProject.file("../package.json").readText())!!.groupValues[1]
val versionNumbers = desktopVersion.split(".").map { part -> part.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }

// The release key lives outside the repo (see the Android plan); without it, builds fall back to the debug key.
val signing = Properties().apply {
    val file = File(System.getProperty("user.home"), ".vyse-android/keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "app.encore.player"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.encore.player"
        minSdk = 26
        targetSdk = 37
        versionCode = versionNumbers[0] * 10_000 + versionNumbers[1] * 100 + versionNumbers[2]
        versionName = desktopVersion
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("vyse") {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("vyse") ?: signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/versions/9/OSGI-INF/MANIFEST.MF", "DebugProbesKt.bin")
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    lint {
        // Media3's "unstable" parts are used on purpose, pinned to one version
        disable += "UnsafeOptInUsageError"
    }
}

dependencies {
    implementation(project(":youtube"))
    implementation(libs.coroutines.android)

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.palette)
    implementation(libs.androidx.profileinstaller)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.foundation)
    implementation(libs.compose.animation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.media3.datasource.okhttp)

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.haze)
    implementation(libs.haze.blur)

    testImplementation(libs.junit)
    testImplementation(kotlin("test"))
}

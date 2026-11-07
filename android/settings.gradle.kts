pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "vyse-music-android"

// :core holds the app's data shapes and pure rules (queue, text matching); :youtube talks to
// YouTube Music. Both are plain Kotlin, so their tests run on the PC without a phone.
include(":core", ":youtube", ":app")

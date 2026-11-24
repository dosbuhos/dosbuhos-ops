plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version code = CI run number, so every build installs over the last one.
val ciRun = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "mx.contemplo.studio"
    compileSdk = 36
    defaultConfig {
        applicationId = "mx.contemplo.studio"
        minSdk = 26
        targetSdk = 35
        versionCode = ciRun
        versionName = "1.0.$ciRun"
        // CI's emulator test points the app at a local Worker (http://10.0.2.2:8787); real builds use the deployed one.
        val cloud = System.getenv("CONTEMPLO_CLOUD_URL") ?: "https://contemplo.dos-buhos.workers.dev"
        buildConfigField("String", "CLOUD_URL", "\"$cloud\"")
        manifestPlaceholders["cleartext"] = if (cloud.startsWith("http://")) "true" else "false"
    }
    signingConfigs {
        // A committed debug key (public by design, like any Android debug key): every CI build has the same signature, so
        // an update installs over the previous app and the TV stays paired. Installing still needs adb access to the TV.
        getByName("debug") {
            storeFile = file("debug.keystore"); storePassword = "android"; keyAlias = "androiddebugkey"; keyPassword = "android"
        }
    }
    buildTypes {
        release { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("debug") }
    }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    lint { abortOnError = false; checkReleaseBuilds = false }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    val media3 = "1.11.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-ui:$media3")          // AspectRatioFrameLayout only; no playback UI is ever shown
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.nanohttpd:nanohttpd:2.3.1")              // the local show-control server on port 8320
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}

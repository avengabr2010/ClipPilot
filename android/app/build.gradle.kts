plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// URL of the deployed ClipPilot web app. Empty = the app asks for it on first launch.
val appUrl: String = (project.findProperty("appUrl") as String?) ?: ""
val appVersionName: String = (project.findProperty("versionName") as String?) ?: "0.1.0"
val appVersionCode: Int = ((project.findProperty("versionCode") as String?) ?: "1").toInt()

android {
    namespace = "com.clippilot.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.clippilot.app"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("ANDROID_KEYSTORE_PATH")
            if (!ks.isNullOrBlank()) {
                storeFile = file(ks)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("ANDROID_KEYSTORE_PATH").isNullOrBlank())
                signingConfigs.getByName("debug") else signingConfigs.getByName("release")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}

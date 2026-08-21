plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vertrise.jumptool"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vertrise.jumptool"
        minSdk = 24
        targetSdk = 35
        versionCode = 3
        versionName = "1.2.0"
        // 只打包手机架构（arm），去掉模拟器用的 x86/x86_64，显著减小 APK
        ndk {
            abiFilters += listOf("armeabi-v7a", "arm64-v8a")
        }
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            storeFile = file("../vertrise-release.keystore")
            storePassword = "Vertrise2026!"
            keyAlias = "vertrise"
            keyPassword = "Vertrise2026!"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.google.mediapipe:tasks-vision:0.10.14")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

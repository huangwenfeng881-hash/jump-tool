import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---- 把仓库根目录的网站资源同步进 APK（App 离线也能用）----
val siteAssetsOut = layout.buildDirectory.dir("generated/siteAssets")
val syncSiteAssets by tasks.registering(Sync::class) {
    val repoRoot = projectDir.parentFile.parentFile
    from(repoRoot) {
        include("*.html")
        include("css/**")
        include("js/**")
        include("img/**")
        include("mediapipe/**")
        exclude("**/*.map")
    }
    into(siteAssetsOut.map { it.dir("site") })
    doLast {
        val f = siteAssetsOut.get().dir("site/_asset_version.json").asFile
        f.writeText("{\"versionName\":\"" + android.defaultConfig.versionName + "\",\"builtAt\":\"" + System.currentTimeMillis() + "\"}")
    }
}
tasks.named("preBuild") { dependsOn(syncSiteAssets) }

// 签名口令不写进仓库：android/local.properties 或环境变量提供
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun secret(name: String): String =
    (localProps.getProperty(name) ?: System.getenv(name) ?: "").trim()

android {
    namespace = "com.vertrise.jumptool"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vertrise.jumptool"
        minSdk = 24
        targetSdk = 35
        versionCode = 16
        versionName = "1.7.4"
        // 只打包手机架构（arm），去掉模拟器用的 x86/x86_64，显著减小 APK
        ndk {
            abiFilters += listOf("armeabi-v7a", "arm64-v8a")
        }
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/siteAssets"))

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            storeFile = file("../vertrise-release.keystore")
            storePassword = secret("VERTRISE_STORE_PASSWORD")
            keyAlias = "vertrise"
            keyPassword = secret("VERTRISE_KEY_PASSWORD")
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

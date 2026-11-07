# The queue and settings are saved as JSON with kotlinx.serialization; keep the generated serializers.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class app.encore.player.**$$serializer { *; }
-keepclassmembers class app.encore.player.** { *** Companion; }
-keepclasseswithmembers class app.encore.player.** { kotlinx.serialization.KSerializer serializer(...); }

# OkHttp ships its own rules; these quiet warnings about optional TLS providers.
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**

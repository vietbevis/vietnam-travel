# Nhật ký cài đặt thêm (smartcard)

Mọi thứ được cài thêm trên máy trong quá trình implement, để bạn kiểm soát/gỡ bỏ.
Mỗi mục: thời gian · thứ đã cài · lệnh · vị trí · lý do · cách gỡ.

| Thời gian | Thứ cài | Lệnh | Vị trí | Lý do | Cách gỡ |
|---|---|---|---|---|---|
| 2026-11-06 15:36 | Gradle wrapper 9.7.0 (gradlew, gradle/wrapper) | `cd smartcard && gradle wrapper --gradle-version 9.7.0` | smartcard/gradlew, smartcard/gradlew.bat, smartcard/gradle/wrapper/ | Build applet with pinned Gradle | `rm -rf smartcard/gradlew smartcard/gradlew.bat smartcard/gradle` (distribution cache: ~/.gradle/wrapper/dists/gradle-9.7.0-bin) |
| 2026-11-06 15:37 | Gradle dependency cache (jcardsim 3.0.5.11, JUnit 5.11.4, Gradle 9.7.0 dist) | `./gradlew :applet:test` (auto-download) | ~/.gradle/caches, ~/.gradle/wrapper/dists | Build/test deps | `rm -rf ~/.gradle/caches/modules-2 ~/.gradle/wrapper/dists/gradle-9.7.0-bin` |

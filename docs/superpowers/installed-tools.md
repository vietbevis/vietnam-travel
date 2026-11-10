# Nhật ký cài đặt thêm (smartcard)

Mọi thứ được cài thêm trên máy trong quá trình implement, để bạn kiểm soát/gỡ bỏ.
Mỗi mục: thời gian · thứ đã cài · lệnh · vị trí · lý do · cách gỡ.

| Thời gian | Thứ cài | Lệnh | Vị trí | Lý do | Cách gỡ |
|---|---|---|---|---|---|
| 2026-11-06 15:36 | Gradle wrapper 9.7.0 (gradlew, gradle/wrapper) | `cd smartcard && gradle wrapper --gradle-version 9.7.0` | smartcard/gradlew, smartcard/gradlew.bat, smartcard/gradle/wrapper/ | Dựng applet với Gradle cố định phiên bản | `rm -rf smartcard/gradlew smartcard/gradlew.bat smartcard/gradle` (cache bản phân phối: ~/.gradle/wrapper/dists/gradle-9.7.0-bin) |
| 2026-11-06 15:37 | Gradle dependency cache (jcardsim 3.0.5.11, JUnit 5.11.4, Gradle 9.7.0 dist) | `./gradlew :applet:test` (tự tải) | ~/.gradle/caches, ~/.gradle/wrapper/dists | Phụ thuộc dựng/kiểm thử | `rm -rf ~/.gradle/caches/modules-2 ~/.gradle/wrapper/dists/gradle-9.7.0-bin` |
| 2026-11-06 16:09 | ant-javacard.jar (latest release) | `curl -fsSL -o smartcard/tools/ant-javacard.jar https://github.com/martinpaljak/ant-javacard/releases/latest/download/ant-javacard.jar` | smartcard/tools/ant-javacard.jar (bị git bỏ qua) | Ant task chuyển đổi CAP Java Card (plan 01 Task 9) | `rm smartcard/tools/ant-javacard.jar` |
| 2026-11-06 16:09 | oracle_javacard_sdks (Java Card SDK kits, ~100MB) | `git clone --depth 1 https://github.com/martinpaljak/oracle_javacard_sdks smartcard/tools/sdks` | smartcard/tools/sdks (bị git bỏ qua) | Bộ chuyển đổi + jar API để dựng CAP | `rm -rf smartcard/tools/sdks` |
| 2026-11-06 16:10 | openjdk@17 (Homebrew) | `brew install openjdk@17` | /opt/homebrew/opt/openjdk@17 (keg-only, không nằm trong PATH) | Bộ chuyển đổi Java Card (ant-javacard) từ chối JDK 25 với kit v24.0; chỉ dùng cho `:applet:cap` qua JAVA_HOME | `brew uninstall openjdk@17` |
| 2026-11-06 | Gson 2.11.0 và junit-platform-launcher (phiên bản do JUnit BOM 5.11.4 chọn, khai báo trong `smartcard/agent/build.gradle.kts`) | `cd smartcard && ./gradlew :agent:test` (tự tải) | ~/.gradle/caches/modules-2 | Phân tích JSON cho Card Agent; launcher để Gradle chạy JUnit | `rm -rf ~/.gradle/caches/modules-2` (hoặc chỉ xóa thư mục `com.google.code.gson` và `org.junit.platform`) |
| 2026-11-10 | Docker image mongo:7 + container travel-smartcard-test-mongo (replica set travelTask4, 127.0.0.1:27018); node_modules qua npm install --legacy-peer-deps | docker pull mongo:7; docker run ... mongod --replSet travelTask4 --port 27018; npm install --legacy-peer-deps --no-package-lock | Docker, node_modules | Chạy integration/Edge Task 13 (máy chưa có mongod) | docker rm -f travel-smartcard-test-mongo; docker rmi mongo:7; xóa node_modules |

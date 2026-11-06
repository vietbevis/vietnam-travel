plugins {
    java
}

repositories {
    mavenCentral()
}

dependencies {
    compileOnly("com.klinec:jcardsim:3.0.5.11")
    testImplementation("com.klinec:jcardsim:3.0.5.11")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.compileJava {
    options.release = 8
}

tasks.compileTestJava {
    options.release = 17
}

tasks.test {
    useJUnitPlatform()
}

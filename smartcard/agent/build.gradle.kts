plugins {
    java
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(project(":applet"))
    implementation("com.klinec:jcardsim:3.0.5.11")
    implementation("com.google.code.gson:gson:2.11.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application {
    mainClass = "vn.travel.agent.AgentMain"
}

tasks.compileJava {
    options.release = 17
}

tasks.compileTestJava {
    options.release = 17
}

tasks.test {
    useJUnitPlatform()
}

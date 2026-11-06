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

// Builds build/travelcard.cap with ant-javacard (Java Card converter + verifier).
tasks.register("cap") {
    group = "build"
    description = "Converts the applet to a Java Card CAP file (build/travelcard.cap)"
    dependsOn(tasks.compileJava)
    val tools = rootProject.layout.projectDirectory.dir("tools").asFile
    val outFile = layout.buildDirectory.file("travelcard.cap").get().asFile
    val srcDir = layout.projectDirectory.dir("src/main/java").asFile
    doLast {
        ant.withGroovyBuilder {
            "taskdef"(
                "name" to "javacard",
                "classname" to "pro.javacard.ant.JavaCard",
                "classpath" to File(tools, "ant-javacard.jar").absolutePath,
            )
            "javacard"("jckit" to File(tools, "sdks/" + (findProperty("capJckit") ?: "jc320v24.0_kit")).absolutePath) {
                "cap"(
                    "targetsdk" to File(tools, "sdks/" + (findProperty("capTarget") ?: "jc304_kit")).absolutePath,
                    "aid" to "F054524156454C00",
                    "output" to outFile.absolutePath,
                    "sources" to srcDir.absolutePath,
                    "version" to "1.0",
                    "verify" to (findProperty("capVerify") ?: "false").toString(),
                ) {
                    "applet"("class" to "vn.travel.card.TravelCardApplet", "aid" to "F054524156454C01")
                }
            }
        }
    }
}

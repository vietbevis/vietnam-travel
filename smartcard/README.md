# Travel smartcard applet

Java Card applet `vn.travel.card.TravelCardApplet` (AID `F054524156454C01`, package AID `F054524156454C00`).
Spec: `docs/superpowers/specs/2026-11-04-travel-smartcard-design.md` section 3.

## Run the tests

    cd smartcard
    ./gradlew :applet:test

Runs on the default JDK (17+; tested with 25) against jCardSim. `TestVectorsExport` regenerates
`test-vectors/vectors.json` (consumed by the web side, plan 03 Task 1); the card key pair is random, so the
file changes on every run.

## Build the CAP

One-time tool setup (both are git-ignored under `smartcard/tools/`):

    mkdir -p smartcard/tools
    curl -fsSL -o smartcard/tools/ant-javacard.jar https://github.com/martinpaljak/ant-javacard/releases/latest/download/ant-javacard.jar
    git clone --depth 1 https://github.com/martinpaljak/oracle_javacard_sdks smartcard/tools/sdks

Then build with **JDK 17** (the converter refuses JDK 25 with the v24.0 kit):

    cd smartcard
    JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ./gradlew :applet:cap

Output: `smartcard/applet/build/travelcard.cap` (kit `jc320v24.0_kit`, target `jc304_kit`, i.e. Java Card 3.0.4+).

Notes:
- The off-card verifier in the kit cannot read the 3.0.4 export files ("unsupported export file format"),
  so verification is off by default for the 3.0.4 target. To run the verifier, target 3.1 instead:
  `./gradlew :applet:cap -PcapTarget=jc310r20210706_kit -PcapVerify=true` (passes; output is a 3.1-targeted CAP,
  overwrite it by re-running the default build before installing on a 3.0.x card).
- Override kits with `-PcapJckit=<dir>` / `-PcapTarget=<dir>` (dirs under `tools/sdks`).
- Size: about 48 KB zipped CAP, about 9.5 KB of CAP components (Method ~5.7 KB); persistent data is dominated by
  the 10 080 B photo store. Fits typical 32 KB+ cards.

## Install on a real card (GlobalPlatformPro)

    java -jar gp.jar --install applet/build/travelcard.cap

Remove the applet (also resets a half-installed or broken card):

    java -jar gp.jar --delete F054524156454C00

## Warning

`test-vectors/server-test-key.pem` is a **test-only** server key committed to the repo. Never use it to
personalise real cards; production cards need a server key kept outside git (`keys/`).

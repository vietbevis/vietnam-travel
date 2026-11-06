# Travel smartcard applet

Java Card applet `vn.travel.card.TravelCardApplet` (AID `F054524156454C01`, package AID `F054524156454C00`).
Spec: `docs/superpowers/specs/2026-11-04-travel-smartcard-design.md` section 3.

## Run the tests

    cd smartcard
    ./gradlew :applet:test

Runs on the default JDK (17+; tested with 25) against jCardSim. `TestVectorsExport` generates and
self-verifies a vectors file in a temp location; the committed `test-vectors/vectors.json` (consumed by the web
side, plan 03 Task 1) is only rewritten when you pass the flag (the card key pair is random, so the file changes):

    ./gradlew :applet:test -PwriteVectors

## APDU buffer requirement

All command data is received with a `receiveBytes` loop (first reads may be partial on chained T=1/contactless)
into a 260-byte transient staging buffer (5 + max Lc 255, `CLEAR_ON_DESELECT`), and the APDU buffer copy is
wiped immediately. The card must provide the Java Card minimum APDU buffer of 133 bytes (header 5 + 128 per
read); a transfer that does not deliver exactly Lc bytes fails with `6700`. The staging buffer is zeroed after
every command.

## TERMINATE is tear-safe

SET_STATE 7F commits `state = TERMINATED` plus a `wipePending` flag in one small transaction, then runs the
idempotent wipes (PIN/DEK/escrow, keys, wallet, tickets, 10 KB store) outside it and clears the flag. If power
is lost in between, the wipe is re-run at the start of the next `process()` (including SELECT).

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

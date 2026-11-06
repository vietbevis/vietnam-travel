package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

class ServerAuthTest {
    private static final byte[] NONE = new byte[0];

    private static CardHarness active() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        return c;
    }

    private static int state(CardHarness c) {
        return c.ok(0x10, 0, 0, null)[17] & 0xFF;
    }

    @Test
    void challengeIs16RandomBytes() {
        CardHarness c = active();
        byte[] a = c.getChallenge();
        byte[] b = c.getChallenge();
        assertEquals(16, a.length);
        assertEquals(16, b.length);
        assertFalse(Arrays.equals(a, b));
    }

    @Test
    void lockThenUnlock() {
        CardHarness c = active();
        assertEquals(0x9000, c.signed(0x70, 0x03, 0, NONE).getSW());
        assertEquals(0x03, state(c));
        c.assertSw(0x6985, 0x20, 0, 0, CardHarness.ascii(c.pin));
        assertEquals(0x9000, c.signed(0x70, 0x02, 0, NONE).getSW());
        assertEquals(0x02, state(c));
        c.verifyPin();
    }

    @Test
    void sameStateIsNoOp() {
        CardHarness c = active();
        assertEquals(0x9000, c.signed(0x70, 0x02, 0, NONE).getSW());
        assertEquals(0x02, state(c));
    }

    @Test
    void badTargetRejected() {
        CardHarness c = active();
        assertEquals(0x6A86, c.signed(0x70, 0x05, 0, NONE).getSW());
        assertEquals(0x02, state(c));
    }

    // Review Focus #1
    @Test
    void replayRejected() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x70, 0x03, 0, NONE);
        assertEquals(0x9000, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x03, state(c));
        // unlock via a fresh signed command, then replay the old LOCK verbatim
        assertEquals(0x9000, c.signed(0x70, 0x02, 0, NONE).getSW());
        assertEquals(0x6F21, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x02, state(c), "replayed command must not execute");
    }

    @Test
    void replayWithFreshChallengeStillRejected() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x70, 0x03, 0, NONE);
        assertEquals(0x9000, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x9000, c.signed(0x70, 0x02, 0, NONE).getSW());
        c.getChallenge(); // a new challenge exists, but the old signature binds the old one
        assertEquals(0x6F20, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x02, state(c));
    }

    // Review Focus #2
    @Test
    void otherCardIdRejected() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.filled(16, (byte) 0x22), 0x70, 0x03, 0, NONE);
        assertEquals(0x6F20, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x02, state(c));
        assertEquals(0x6F21, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x02, state(c));
    }

    @Test
    void wrongSignatureDestroysChallenge() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x70, 0x03, 0, NONE);
        d[5] ^= 0x01;
        assertEquals(0x6F20, c.send(0x70, 0x03, 0, d).getSW());
        d[5] ^= 0x01;
        assertEquals(0x6F21, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x02, state(c));
    }

    @Test
    void tamperedPayloadRejected() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x70, 0x03, 0, NONE);
        assertEquals(0x6F20, c.send(0x70, 0x7F, 0, d).getSW());
        assertEquals(0x02, state(c));
    }

    @Test
    void tamperedP2Rejected() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x70, 0x03, 0, NONE);
        assertEquals(0x6F20, c.send(0x70, 0x03, 1, d).getSW());
        assertEquals(0x02, state(c));
    }

    @Test
    void shortDataIsWrongLengthAndDestroysChallenge() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x70, 0x03, 0, NONE);
        assertEquals(0x6700, c.send(0x70, 0x03, 0, Arrays.copyOf(d, 100)).getSW());
        assertEquals(0x6F21, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x02, state(c));
    }

    @Test
    void emptyDataWithChallengeIsWrongLength() {
        CardHarness c = active();
        c.getChallenge();
        assertEquals(0x6700, c.send(0x70, 0x03, 0, null).getSW());
        assertEquals(0x6F21, c.send(0x70, 0x03, 0, null).getSW());
    }

    @Test
    void nonEmptyPayloadForSetStateIsWrongLength() {
        CardHarness c = active();
        assertEquals(0x6700, c.signed(0x70, 0x03, 0, new byte[] {1}).getSW());
        assertEquals(0x02, state(c));
    }

    @Test
    void noChallengeRejected() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x70, 0x03, 0, NONE);
        c.reselect();
        assertEquals(0x6F21, c.send(0x70, 0x03, 0, d).getSW());
        assertEquals(0x02, state(c));
    }

    @Test
    void neverIssuedChallengeRejected() {
        CardHarness c = active();
        assertEquals(0x6F21, c.send(0x70, 0x03, 0, new byte[128]).getSW());
    }

    @Test
    void newChallengeInvalidatesOldSignature() {
        CardHarness c = active();
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x70, 0x03, 0, NONE);
        c.getChallenge();
        assertEquals(0x6F20, c.send(0x70, 0x03, 0, d).getSW());
    }

    @Test
    void challengeAvailableWhenLocked() {
        CardHarness c = active();
        assertEquals(0x9000, c.signed(0x70, 0x03, 0, NONE).getSW());
        assertEquals(16, c.getChallenge().length);
    }

    @Test
    void terminateWipes() {
        CardHarness c = active();
        assertEquals(0x9000, c.signed(0x70, 0x7F, 0, NONE).getSW());
        assertEquals(0x7F, state(c));
        c.assertSw(0x6985, 0x30, 0, 0, null);
        c.assertSw(0x6985, 0x32, 0, 0, null);
    }

    @Test
    void terminatedCardCannotBeVerified() {
        CardHarness c = active();
        assertEquals(0x9000, c.signed(0x70, 0x7F, 0, NONE).getSW());
        c.assertSw(0x6985, 0x20, 0, 0, CardHarness.ascii(c.pin));
        c.assertSw(0x6985, 0x20, 0, 0, CardHarness.ascii("000000"));
        c.assertSw(0x6985, 0x21, 0, 0, CardHarness.ascii("000000" + "123456"));
        c.assertSw(0x6985, 0x70, 0, 0, new byte[128]);
        assertEquals(0, c.ok(0x10, 0, 0, null)[19], "PIN must be blocked after wipe");
    }

    @Test
    void wipeLeavesPinBlockedNotZeros() {
        PinGuard g = new PinGuard();
        byte[] buf = new byte[32];
        System.arraycopy(CardHarness.ascii("482915"), 0, buf, 0, 6);
        g.init(buf, (short) 0, (short) 6);
        g.wipe();
        byte[] zeros = CardHarness.ascii("000000");
        assertEquals(0, g.triesRemaining());
        assertFalse(g.pin().check(zeros, (short) 0, (byte) 6));
        assertFalse(g.pin().check(CardHarness.ascii("482915"), (short) 0, (byte) 6));
        assertFalse(g.isValidated());
    }

    private static byte[] encPin(String pin) throws Exception {
        byte[] plain = Arrays.copyOf(CardHarness.ascii(pin), 16);
        Cipher ci = Cipher.getInstance("AES/ECB/NoPadding");
        ci.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(TestServer.escrowKey(CardHarness.CARD_ID), "AES"));
        return ci.doFinal(plain);
    }

    @Test
    void resetPinUnblocksAndForcesChange() throws Exception {
        CardHarness c = active();
        for (int i = 4; i >= 0; i--) {
            c.assertSw(0x63C0 | i, 0x20, 0, 0, CardHarness.ascii("000000"));
        }
        assertEquals(0, c.ok(0x10, 0, 0, null)[19]);
        assertEquals(0x9000, c.signed(0x22, 0, 0, encPin("903172")).getSW());
        byte[] info = c.ok(0x10, 0, 0, null);
        assertEquals(5, info[19]);
        assertEquals(1, info[18]);
        c.ok(0x20, 0, 0, CardHarness.ascii("903172"));
    }

    @Test
    void resetPinRejectsNonDigitsAndBadLength() throws Exception {
        CardHarness c = active();
        byte[] bad = encPin("90317A");
        assertEquals(0x6A80, c.signed(0x22, 0, 0, bad).getSW());
        assertEquals(0x6700, c.signed(0x22, 0, 0, new byte[15]).getSW());
        assertEquals(0, c.ok(0x10, 0, 0, null)[18]);
        c.verifyPin();
    }

    @Test
    void resetPinRequiresSignature() throws Exception {
        CardHarness c = active();
        c.assertSw(0x6F21, 0x22, 0, 0, new byte[144]);
    }

    @Test
    void resetPinPreservesDek() throws Exception {
        PinGuard g = new PinGuard();
        byte[] buf = new byte[64];
        byte[] esc = TestServer.escrowKey(CardHarness.CARD_ID);
        System.arraycopy(CardHarness.ascii("482915"), 0, buf, 0, 6);
        System.arraycopy(esc, 0, buf, 6, 16);
        g.init(buf, (short) 0, (short) 6);
        System.arraycopy(CardHarness.ascii("482915"), 0, buf, 0, 6);
        g.verify(buf, (short) 0);
        byte[] before = new byte[16];
        ((javacard.security.AESKey) g.dek()).getKey(before, (short) 0);
        byte[] enc = encPin("903172");
        System.arraycopy(enc, 0, buf, 32, 16);
        g.resetWithEscrow(buf, (short) 32);
        assertFalse(g.isValidated());
        System.arraycopy(CardHarness.ascii("903172"), 0, buf, 0, 6);
        g.verify(buf, (short) 0);
        byte[] after = new byte[16];
        ((javacard.security.AESKey) g.dek()).getKey(after, (short) 0);
        assertArrayEquals(before, after);
        assertNotEquals(0, before[0] | before[1] | before[2] | before[3]);
        assertTrue(g.mustChangePin());
    }

    @Test
    void resetPinKeepsData() throws Exception {
        CardHarness c = active();
        c.verifyPin();
        byte[] profile = new byte[300];
        new java.util.Random(11).nextBytes(profile);
        c.writeTarget(1, profile);
        c.reselect();
        assertEquals(0x9000, c.signed(0x22, 0, 0, encPin("903172")).getSW());
        c.ok(0x20, 0, 0, CardHarness.ascii("903172"));
        // mustChangePin = 1 blocks READ_DATA (6985) until the customer changes the PIN
        c.assertSw(0x6985, 0x40, 0x01, 0xFF, null);
        c.changePin("903172", "260814");
        c.reselect();
        c.verifyPin();
        assertArrayEquals(profile, c.readTarget(1));
    }
}

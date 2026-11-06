package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.Test;

class WalletTest {
    private static CardHarness active() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        return c;
    }

    private static CardHarness.Receipt credit(CardHarness c, int ref, long amt) {
        return c.parseReceipt(c.signedOk(0x51, CardHarness.txPayload(ref, amt)));
    }

    private static byte[] balance(CardHarness c) {
        c.verifyPin();
        return c.ok(0x50, 0, 0, null);
    }

    private static void assertBalance(CardHarness c, long bal, long ctr) {
        byte[] r = balance(c);
        assertEquals(8, r.length);
        assertEquals(bal, CardHarness.u32(r, 0));
        assertEquals(ctr, CardHarness.u32(r, 4));
    }

    @Test
    void creditThenDebit() {
        CardHarness c = active();
        CardHarness.Receipt r1 = credit(c, 1, 1_500_000);
        assertEquals(1, r1.type);
        assertArrayEquals(CardHarness.filled(8, (byte) 1), r1.txRef);
        assertEquals(1_500_000, r1.amount);
        assertEquals(1_500_000, r1.balanceAfter);
        assertEquals(1, r1.counter);
        c.verifyPin();
        CardHarness.Receipt r2 = c.parseReceipt(c.signedOk(0x52, CardHarness.txPayload(2, 400_000)));
        assertEquals(2, r2.type);
        assertEquals(400_000, r2.amount);
        assertEquals(1_100_000, r2.balanceAfter);
        assertEquals(2, r2.counter);
        c.verifyPin();
        assertArrayEquals(new byte[] {0x00, 0x10, (byte) 0xC8, (byte) 0xE0, 0, 0, 0, 2}, c.ok(0x50, 0, 0, null));
    }

    @Test
    void creditUpToMax() {
        CardHarness c = active();
        credit(c, 1, 50_000_000);
        assertBalance(c, 50_000_000, 1);
        assertEquals(0x6F11, c.signed(0x51, 0, 0, CardHarness.txPayload(2, 1)).getSW());
        assertBalance(c, 50_000_000, 1);
    }

    @Test
    void creditOverMaxAtBoundaryFromBelow() {
        CardHarness c = active();
        credit(c, 1, 49_999_999);
        credit(c, 2, 1); // exactly BALANCE_MAX
        assertBalance(c, 50_000_000, 2);
        CardHarness d = active();
        credit(d, 1, 49_999_999);
        assertEquals(0x6F11, d.signed(0x51, 0, 0, CardHarness.txPayload(2, 2)).getSW());
        assertBalance(d, 49_999_999, 1);
    }

    @Test
    void hugeAmountsRejected() {
        CardHarness c = active();
        assertEquals(0x6F11, c.signed(0x51, 0, 0, CardHarness.txPayload(1, 50_000_001)).getSW());
        assertEquals(0x6F11, c.signed(0x51, 0, 0, CardHarness.txPayload(1, 0xFFFFFFFFL)).getSW());
        credit(c, 1, 100);
        assertEquals(0x6F11, c.signed(0x51, 0, 0, CardHarness.txPayload(1, 0xFFFFFFFFL)).getSW());
        c.verifyPin();
        assertEquals(0x6F10, c.signed(0x52, 0, 0, CardHarness.txPayload(1, 0xFFFFFFFFL)).getSW());
        assertBalance(c, 100, 1);
    }

    @Test
    void carryAcrossBytesViaApdu() {
        CardHarness c = active();
        credit(c, 1, 0x00FFFFFFL);
        CardHarness.Receipt r = credit(c, 2, 1);
        assertEquals(0x01000000L, r.balanceAfter);
        assertBalance(c, 0x01000000L, 2);
        c.verifyPin();
        CardHarness.Receipt d = c.parseReceipt(c.signedOk(0x52, CardHarness.txPayload(3, 1)));
        assertEquals(0x00FFFFFFL, d.balanceAfter);
    }

    @Test
    void debitInsufficient() {
        CardHarness c = active();
        credit(c, 1, 100);
        c.verifyPin();
        assertEquals(0x6F10, c.signed(0x52, 0, 0, CardHarness.txPayload(2, 101)).getSW());
        assertBalance(c, 100, 1);
        // exact balance works
        c.verifyPin();
        CardHarness.Receipt r = c.parseReceipt(c.signedOk(0x52, CardHarness.txPayload(3, 100)));
        assertEquals(0, r.balanceAfter);
        assertBalance(c, 0, 2);
    }

    @Test
    void failedTxDoesNotTouchLog() {
        CardHarness c = active();
        credit(c, 1, 100);
        c.verifyPin();
        c.signed(0x52, 0, 0, CardHarness.txPayload(2, 101));
        c.verifyPin();
        byte[] log = c.ok(0x53, 0, 0, null);
        assertEquals(1, log[0]);
        assertEquals(1 + 21, log.length);
    }

    @Test
    void debitNeedsPin() {
        CardHarness c = active();
        credit(c, 1, 100);
        assertEquals(0x6982, c.signed(0x52, 0, 0, CardHarness.txPayload(2, 10)).getSW());
        assertBalance(c, 100, 1);
    }

    @Test
    void debitClearsPin() {
        CardHarness c = active();
        credit(c, 1, 100);
        c.verifyPin();
        c.signedOk(0x52, CardHarness.txPayload(2, 10));
        c.assertSw(0x6982, 0x50, 0, 0, null);
    }

    @Test
    void failedDebitAlsoClearsPin() {
        CardHarness c = active();
        credit(c, 1, 100);
        c.verifyPin();
        assertEquals(0x6F10, c.signed(0x52, 0, 0, CardHarness.txPayload(2, 101)).getSW());
        c.assertSw(0x6982, 0x50, 0, 0, null);
    }

    @Test
    void zeroAmount() {
        CardHarness c = active();
        assertEquals(0x6A80, c.signed(0x51, 0, 0, CardHarness.txPayload(1, 0)).getSW());
        c.verifyPin();
        assertEquals(0x6A80, c.signed(0x52, 0, 0, CardHarness.txPayload(1, 0)).getSW());
        assertBalance(c, 0, 0);
    }

    @Test
    void wrongPayloadLength() {
        CardHarness c = active();
        assertEquals(0x6700, c.signed(0x51, 0, 0, new byte[11]).getSW());
        assertEquals(0x6700, c.signed(0x51, 0, 0, new byte[13]).getSW());
    }

    @Test
    void creditNeedsSignature() {
        CardHarness c = active();
        c.assertSw(0x6F21, 0x51, 0, 0, Arrays.copyOf(CardHarness.txPayload(1, 5), 140));
        byte[] d = c.signedData(CardHarness.CARD_ID, 0x51, 0, 0, CardHarness.txPayload(1, 5));
        d[8] ^= 1; // tamper amount
        assertEquals(0x6F20, c.send(0x51, 0, 0, d).getSW());
        assertBalance(c, 0, 0);
    }

    @Test
    void logNewestFirstAndRing() {
        CardHarness c = active();
        for (int i = 1; i <= 12; i++) {
            credit(c, i, 1);
        }
        c.verifyPin();
        byte[] log = c.ok(0x53, 0, 0, null);
        assertEquals(10, log[0]);
        assertEquals(1 + 210, log.length);
        for (int i = 0; i < 10; i++) {
            int o = 1 + 21 * i;
            assertEquals(1, log[o]);
            assertEquals(1, CardHarness.u32(log, o + 1));
            assertEquals(12 - i, CardHarness.u32(log, o + 9), "counter at " + i);
            assertEquals(12 - i, CardHarness.u32(log, o + 5), "balanceAfter at " + i);
            assertArrayEquals(CardHarness.filled(8, (byte) (12 - i)), Arrays.copyOfRange(log, o + 13, o + 21));
        }
    }

    @Test
    void logPartialAndTypes() {
        CardHarness c = active();
        credit(c, 1, 50);
        c.verifyPin();
        c.signedOk(0x52, CardHarness.txPayload(2, 20));
        c.verifyPin();
        byte[] log = c.ok(0x53, 0, 0, null);
        assertEquals(2, log[0]);
        assertEquals(2, log[1]);
        assertEquals(1, log[1 + 21]);
    }

    @Test
    void emptyLog() {
        CardHarness c = active();
        c.verifyPin();
        assertArrayEquals(new byte[] {0}, c.ok(0x53, 0, 0, null));
    }

    @Test
    void receiptReSigned() {
        CardHarness c = active();
        byte[] first = c.signedOk(0x51, CardHarness.txPayload(1, 777));
        credit(c, 2, 5);
        byte[] again = c.ok(0x54, 0, 0, CardHarness.filled(8, (byte) 1));
        assertEquals(166, again.length);
        assertArrayEquals(Arrays.copyOf(first, 38), Arrays.copyOf(again, 38));
        CardHarness.Receipt r = c.parseReceipt(again);
        assertEquals(777, r.amount);
        assertEquals(1, r.counter);
        // PKCS#1 v1.5 is deterministic, so the whole receipt is identical
        assertArrayEquals(first, again);
    }

    @Test
    void receiptNotFound() {
        CardHarness c = active();
        credit(c, 1, 5);
        c.assertSw(0x6A88, 0x54, 0, 0, CardHarness.filled(8, (byte) 9));
        for (int i = 2; i <= 11; i++) {
            credit(c, i, 1); // 11 total -> ref 1 pushed out of the ring
        }
        c.assertSw(0x6A88, 0x54, 0, 0, CardHarness.filled(8, (byte) 1));
        CardHarness.Receipt r = c.parseReceipt(c.ok(0x54, 0, 0, CardHarness.filled(8, (byte) 2)));
        assertEquals(2, r.counter);
        c.assertSw(0x6700, 0x54, 0, 0, new byte[7]);
    }

    @Test
    void receiptAfterDebitHasType2() {
        CardHarness c = active();
        credit(c, 1, 100);
        c.verifyPin();
        c.signedOk(0x52, CardHarness.txPayload(2, 30));
        CardHarness.Receipt r = c.parseReceipt(c.ok(0x54, 0, 0, CardHarness.filled(8, (byte) 2)));
        assertEquals(2, r.type);
        assertEquals(70, r.balanceAfter);
    }

    @Test
    void staffCardWalletBlocked() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 0x02);
        c.changePin(CardHarness.PIN, CardHarness.ACTIVE_PIN);
        c.verifyPin();
        c.assertSw(0x6986, 0x50, 0, 0, null);
        c.assertSw(0x6986, 0x51, 0, 0, new byte[140]);
        c.assertSw(0x6986, 0x52, 0, 0, new byte[140]);
        c.assertSw(0x6986, 0x53, 0, 0, null);
        c.assertSw(0x6986, 0x54, 0, 0, new byte[8]);
    }

    @Test
    void authCounterTracksWallet() {
        CardHarness c = active();
        credit(c, 1, 10);
        credit(c, 2, 10);
        c.verifyPin();
        byte[] nonce = CardHarness.filled(16, (byte) 7);
        byte[] r = c.ok(0x31, 0, 0, nonce);
        assertArrayEquals(new byte[] {0, 0, 0, 2}, Arrays.copyOf(r, 4));
        byte[] msg = new byte[37];
        msg[0] = 0x41;
        System.arraycopy(nonce, 0, msg, 1, 16);
        System.arraycopy(CardHarness.CARD_ID, 0, msg, 17, 16);
        System.arraycopy(r, 0, msg, 33, 4);
        assertTrue(c.verifyCardSig(msg, Arrays.copyOfRange(r, 4, 132)));
    }

    @Test
    void receiptTagAndLengthDistinctFromAuthAndCmd() {
        assertNotEquals(0x41, Wallet.TAG_RCPT);
        assertNotEquals(0x43, Wallet.TAG_RCPT);
        assertEquals(0x52, Wallet.TAG_RCPT);
        assertNotEquals(37, Wallet.RCPT_MSG_LEN);
        assertEquals(38, Wallet.RCPT_MSG_LEN);
    }

    @Test
    void receiptSignatureNotValidAsAuthenticate() {
        CardHarness c = active();
        byte[] rc = c.signedOk(0x51, CardHarness.txPayload(1, 5));
        byte[] sig = Arrays.copyOfRange(rc, 38, 166);
        // Same 38 bytes with tag swapped to M_auth, or truncated to 37: both must fail.
        byte[] asAuth = Arrays.copyOf(rc, 38);
        asAuth[0] = 0x41;
        assertTrue(!c.verifyCardSig(asAuth, sig));
        assertTrue(!c.verifyCardSig(Arrays.copyOf(rc, 37), sig));
    }

    @Test
    void terminateWipesWallet() throws Exception {
        CardHarness c = active();
        credit(c, 1, 10);
        ResponseAPDU r = c.signed(0x70, 0x7F, 0, new byte[0]);
        assertEquals(0x9000, r.getSW());
        c.assertSw(0x6985, 0x54, 0, 0, CardHarness.filled(8, (byte) 1));
    }
}

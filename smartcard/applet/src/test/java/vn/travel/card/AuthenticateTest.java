package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.SecureRandom;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class AuthenticateTest {
    private static byte[] nonce(int n) {
        byte[] b = new byte[n];
        new SecureRandom().nextBytes(b);
        return b;
    }

    @Test
    void authSignsNonceCardIdCounter() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        c.verifyPin();
        byte[] nonce = nonce(16);
        byte[] r = c.ok(0x31, 0, 0, nonce);
        assertEquals(132, r.length);
        byte[] counter = Arrays.copyOfRange(r, 0, 4);
        assertArrayEquals(new byte[4], counter);
        byte[] msg = new byte[37];
        msg[0] = 0x41;
        System.arraycopy(nonce, 0, msg, 1, 16);
        System.arraycopy(CardHarness.CARD_ID, 0, msg, 17, 16);
        System.arraycopy(counter, 0, msg, 33, 4);
        assertTrue(c.verifyCardSig(msg, Arrays.copyOfRange(r, 4, 132)));
        msg[1] ^= 1;
        org.junit.jupiter.api.Assertions.assertFalse(c.verifyCardSig(msg, Arrays.copyOfRange(r, 4, 132)));
    }

    @Test
    void authNeedsPin() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        c.assertSw(0x6982, 0x31, 0, 0, nonce(16));
    }

    @Test
    void authWrongLength() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        c.verifyPin();
        c.assertSw(0x6700, 0x31, 0, 0, nonce(15));
        c.assertSw(0x6700, 0x31, 0, 0, nonce(17));
    }

    @Test
    void staffCardCanAuth() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 0x02);
        c.changePin(CardHarness.PIN, CardHarness.ACTIVE_PIN);
        c.verifyPin();
        byte[] nonce = nonce(16);
        byte[] r = c.ok(0x31, 0, 0, nonce);
        assertEquals(132, r.length);
    }
}

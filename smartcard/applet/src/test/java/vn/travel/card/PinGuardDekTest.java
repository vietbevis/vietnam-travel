package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import javacard.framework.ISOException;
import org.junit.jupiter.api.Test;

/** White-box: the session DEK must not stay live after a failed PIN check. */
class PinGuardDekTest {
    private static byte[] b(String s) {
        return CardHarness.ascii(s);
    }

    private static PinGuard opened() {
        PinGuard g = new PinGuard();
        byte[] buf = new byte[32];
        System.arraycopy(b("482915"), 0, buf, 0, 6);
        g.init(buf, (short) 0, (short) 6);
        g.verify(buf, (short) 0);
        assertTrue(g.dek().isInitialized());
        return g;
    }

    @Test
    void wrongVerifyClearsDek() {
        PinGuard g = opened();
        byte[] bad = b("000000");
        assertThrows(ISOException.class, () -> g.verify(bad, (short) 0));
        assertFalse(g.dek().isInitialized());
        assertFalse(g.isValidated());
    }

    @Test
    void failedChangeClearsDek() {
        PinGuard g = opened();
        byte[] buf = b("000000715043");
        assertThrows(ISOException.class, () -> g.change(buf, (short) 0, (short) 6));
        assertFalse(g.dek().isInitialized());
        assertFalse(g.isValidated());
    }

    @Test
    void blockedVerifyClearsDek() {
        PinGuard g = opened();
        byte[] bad = b("000000");
        for (int i = 0; i < 5; i++) {
            assertThrows(ISOException.class, () -> g.verify(bad, (short) 0));
        }
        byte[] good = b("482915");
        assertThrows(ISOException.class, () -> g.verify(good, (short) 0));
        assertFalse(g.dek().isInitialized());
    }
}

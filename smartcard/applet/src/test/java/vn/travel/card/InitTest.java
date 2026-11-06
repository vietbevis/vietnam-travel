package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Arrays;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

class InitTest {
    @Test
    void initReturnsModulusAndActivates() {
        CardHarness c = CardHarness.fresh();
        byte[] mod = c.personalize((byte) 0x01);
        assertEquals(128, mod.length);
        byte[] info = c.ok(0x10, 0, 0, null);
        assertArrayEquals(CardHarness.CARD_ID, Arrays.copyOfRange(info, 0, 16));
        assertEquals(0x01, info[16]);
        assertEquals(0x02, info[17]);
        assertEquals(1, info[18]);
    }

    @Test
    void initOnlyOnce() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 0x01);
        c.assertSw(0x6985, 0x01, 0, 0, new byte[167]);
    }

    @Test
    void initWrongLength() {
        CardHarness.fresh().assertSw(0x6700, 0x01, 0, 0, new byte[166]);
    }

    private static byte[] payload(byte type, String pin) {
        byte[] d = new byte[167];
        System.arraycopy(CardHarness.CARD_ID, 0, d, 0, 16);
        d[16] = type;
        System.arraycopy(TestServer.modulus(), 0, d, 17, 128);
        System.arraycopy(pin.getBytes(), 0, d, 145, 6);
        return d;
    }

    @Test
    void initRejectsNonDigitPin() {
        CardHarness c = CardHarness.fresh();
        c.assertSw(0x6A80, 0x01, 0, 0, payload((byte) 1, "48291A"));
        assertEquals(0x00, c.ok(0x10, 0, 0, null)[17]);
    }

    @Test
    void initRejectsBadCardType() {
        CardHarness c = CardHarness.fresh();
        c.assertSw(0x6A80, 0x01, 0, 0, payload((byte) 3, "482915"));
        assertEquals(0x00, c.ok(0x10, 0, 0, null)[17]);
    }

    @Test
    void pubkeyMatchesInit() {
        CardHarness c = CardHarness.fresh();
        byte[] mod = c.activate();
        org.junit.jupiter.api.Assertions.assertArrayEquals(mod, c.ok(0x32, 0, 0, null));
    }
}

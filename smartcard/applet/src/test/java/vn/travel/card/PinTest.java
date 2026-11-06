package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

class PinTest {
    private static byte[] b(String s) {
        return CardHarness.ascii(s);
    }

    private static byte[] two(String a, String c) {
        return CardHarness.ascii(a + c);
    }

    @Test
    void wrongPinCountsDown() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 1);
        c.assertSw(0x63C4, 0x20, 0, 0, b("000000"));
        c.assertSw(0x63C3, 0x20, 0, 0, b("000000"));
        c.assertSw(0x63C2, 0x20, 0, 0, b("000000"));
        c.assertSw(0x63C1, 0x20, 0, 0, b("000000"));
    }

    @Test
    void fifthWrongPinBlocks() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 1);
        for (int i = 4; i >= 1; i--) {
            c.assertSw(0x63C0 | i, 0x20, 0, 0, b("000000"));
        }
        c.assertSw(0x63C0, 0x20, 0, 0, b("000000"));
        c.assertSw(0x6983, 0x20, 0, 0, b(CardHarness.PIN));
        assertEquals(0, c.ok(0x10, 0, 0, null)[19]);
    }

    @Test
    void correctPinResetsCounter() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 1);
        c.assertSw(0x63C4, 0x20, 0, 0, b("000000"));
        c.assertSw(0x63C3, 0x20, 0, 0, b("000000"));
        c.ok(0x20, 0, 0, b(CardHarness.PIN));
        assertEquals(5, c.ok(0x10, 0, 0, null)[19]);
    }

    @Test
    void mustChangePinGatesCommands() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 1);
        c.ok(0x20, 0, 0, b(CardHarness.PIN));
        c.assertSw(0x6985, 0x31, 0, 0, null);
    }

    @Test
    void changePinClearsFlag() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        assertEquals(0, c.ok(0x10, 0, 0, null)[18]);
        c.assertSw(0x63C4, 0x20, 0, 0, b(CardHarness.PIN));
        c.ok(0x20, 0, 0, b(CardHarness.ACTIVE_PIN));
        assertEquals(5, c.ok(0x10, 0, 0, null)[19]);
    }

    @Test
    void changePinWrongOld() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 1);
        c.assertSw(0x63C4, 0x21, 0, 0, two("000000", "715043"));
        assertEquals(1, c.ok(0x10, 0, 0, null)[18]);
        c.ok(0x20, 0, 0, b(CardHarness.PIN));
    }

    @Test
    void changePinRejectsBadInput() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 1);
        c.assertSw(0x6700, 0x21, 0, 0, b("482915"));
        c.assertSw(0x6A80, 0x21, 0, 0, two(CardHarness.PIN, "71504X"));
        assertEquals(1, c.ok(0x10, 0, 0, null)[18]);
    }

    @Test
    void verifyWrongLength() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 1);
        c.assertSw(0x6700, 0x20, 0, 0, b("12345"));
    }

    @Test
    void reselectDropsPinSession() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        c.verifyPin();
        // validated: PIN gate passes (READ_DATA itself is not implemented yet -> 6D00)
        assertEquals(0x6D00, c.send(0x40, 0x01, 0xFF, null).getSW());
        c.reselect();
        c.assertSw(0x6982, 0x40, 0x01, 0xFF, null);
        c.verifyPin();
        assertEquals(0x6D00, c.send(0x40, 0x01, 0xFF, null).getSW());
    }

    @Disabled("enabled in Task 6 (needs profile write/read)")
    @Test
    void dekSurvivesPinChange() {}
}

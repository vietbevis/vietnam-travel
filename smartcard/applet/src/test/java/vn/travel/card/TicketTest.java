package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Arrays;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.Test;

class TicketTest {
    private static final byte[] TOUR = CardHarness.filled(12, (byte) 0xAB);

    private static CardHarness active() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        return c;
    }

    private static byte[] t(int n) {
        return CardHarness.ticket(String.format("ORD%09d", n), TOUR, "20261231", 2);
    }

    private static byte[] key(byte[] ticket) {
        return Arrays.copyOf(ticket, 24);
    }

    private static byte[] read(CardHarness c) {
        c.verifyPin();
        return c.ok(0x61, 0, 0, null);
    }

    @Test
    void writeReadUse() {
        CardHarness c = active();
        byte[] t1 = t(1);
        c.signedOk(0x60, t1);
        byte[] r = read(c);
        assertEquals(35, r.length);
        assertEquals(1, r[0]);
        assertEquals(1, r[1]);
        assertArrayEquals(t1, Arrays.copyOfRange(r, 2, 35));
        c.signedOk(0x62, key(t1));
        r = read(c);
        assertEquals(1, r[0]);
        assertEquals(2, r[1]);
    }

    @Test
    void duplicateWriteIdempotent() {
        CardHarness c = active();
        c.signedOk(0x60, t(1));
        c.signedOk(0x60, t(1));
        assertEquals(1, read(c)[0]);
    }

    @Test
    void fullSlots() {
        CardHarness c = active();
        for (int i = 1; i <= 5; i++) {
            c.signedOk(0x60, t(i));
        }
        byte[] before = read(c);
        assertEquals(5, before[0]);
        assertEquals(0x6A84, c.signed(0x60, 0, 0, t(6)).getSW());
        assertArrayEquals(before, read(c));
        c.signedOk(0x62, key(t(2)));
        c.signedOk(0x60, t(6));
        byte[] r = read(c);
        assertEquals(5, r[0]);
        assertArrayEquals(t(6), Arrays.copyOfRange(r, 1 + 34 + 1, 1 + 34 + 34));
        assertEquals(1, r[1 + 34]);
    }

    @Test
    void useTwice() {
        CardHarness c = active();
        c.signedOk(0x60, t(1));
        c.signedOk(0x62, key(t(1)));
        assertEquals(0x6985, c.signed(0x62, 0, 0, key(t(1))).getSW());
    }

    @Test
    void useUnknown() {
        CardHarness c = active();
        assertEquals(0x6A88, c.signed(0x62, 0, 0, key(t(1))).getSW());
    }

    @Test
    void deleteFreesSlot() {
        CardHarness c = active();
        c.signedOk(0x60, t(1));
        c.signedOk(0x63, key(t(1)));
        assertEquals(0, read(c)[0]);
        assertEquals(0x6A88, c.signed(0x63, 0, 0, key(t(1))).getSW());
    }

    @Test
    void deleteClearsAllSlotsWithSameKey() {
        CardHarness c = active();
        c.signedOk(0x60, t(1));
        c.signedOk(0x62, key(t(1)));
        c.signedOk(0x60, t(1));
        c.signedOk(0x62, key(t(1)));
        assertEquals(2, read(c)[0]);
        c.signedOk(0x63, key(t(1)));
        assertEquals(0, read(c)[0]);
        assertEquals(0x6A88, c.signed(0x63, 0, 0, key(t(1))).getSW());
    }

    @Test
    void deleteFreesFullCard() {
        CardHarness c = active();
        for (int i = 1; i <= 5; i++) {
            c.signedOk(0x60, t(i));
        }
        c.signedOk(0x63, key(t(3)));
        c.signedOk(0x60, t(6));
        assertEquals(5, read(c)[0]);
    }

    @Test
    void readNeedsPin() {
        CardHarness c = active();
        assertEquals(0x6982, c.send(0x61, 0, 0, null).getSW());
    }

    @Test
    void wrongPayloadLength() {
        CardHarness c = active();
        assertEquals(0x6700, c.signed(0x60, 0, 0, Arrays.copyOf(t(1), 32)).getSW());
        assertEquals(0x6700, c.signed(0x62, 0, 0, Arrays.copyOf(t(1), 23)).getSW());
        assertEquals(0x6700, c.signed(0x63, 0, 0, t(1)).getSW());
    }

    @Test
    void replayedSignedCommandFails() {
        CardHarness c = active();
        byte[] data = c.signedData(CardHarness.CARD_ID, 0x60, 0, 0, t(1));
        assertEquals(0x9000, c.send(0x60, 0, 0, data).getSW());
        assertEquals(0x6F21, c.send(0x60, 0, 0, data).getSW());
    }

    @Test
    void unsignedWriteRejected() {
        CardHarness c = active();
        c.getChallenge();
        byte[] bad = new byte[33 + 128];
        ResponseAPDU r = c.send(0x60, 0, 0, bad);
        assertEquals(0x6F20, r.getSW());
        assertEquals(0, read(c)[0]);
    }

    @Test
    void staffCardRejected() {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 2);
        c.changePin(CardHarness.PIN, CardHarness.ACTIVE_PIN);
        c.verifyPin();
        assertEquals(0x6986, c.send(0x61, 0, 0, null).getSW());
        assertEquals(0x6986, c.signed(0x60, 0, 0, t(1)).getSW());
    }

    @Test
    void survivesReselect() {
        CardHarness c = active();
        c.signedOk(0x60, t(1));
        c.signedOk(0x60, t(2));
        c.signedOk(0x62, key(t(2)));
        c.reselect();
        byte[] r = read(c);
        assertEquals(2, r[0]);
        assertArrayEquals(t(1), Arrays.copyOfRange(r, 2, 35));
        assertEquals(2, r[35]);
    }

    @Test
    void terminateWipesTickets() {
        CardHarness c = active();
        c.signedOk(0x60, t(1));
        assertEquals(0x9000, c.signed(0x70, 0x7F, 0, new byte[0]).getSW());
        byte[] info = c.ok(0x10, 0, 0, null);
        assertEquals(0x7F, info[17]);
        assertEquals(0x6985, c.send(0x61, 0, 0, null).getSW());
        assertEquals(0x6985, c.send(0x60, 0, 0, new byte[33 + 128]).getSW());
    }
}

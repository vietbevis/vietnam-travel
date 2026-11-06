package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class SkeletonTest {
    @Test
    void publicInfoOnBlankCard() {
        byte[] r = CardHarness.fresh().ok(0x10, 0, 0, null);
        assertEquals(21, r.length);
        assertArrayEquals(new byte[16], Arrays.copyOfRange(r, 0, 16)); // cardId = 0
        assertEquals(0x00, r[16]); // cardType
        assertEquals(0x00, r[17]); // state CREATED
        assertEquals(5, r[19]);    // triesRemaining
        assertEquals(0x01, r[20]); // version
    }

    @Test
    void wrongClaIs6E00() {
        assertEquals(0x6E00, CardHarness.fresh().sendCla(0x00, 0x10, 0, 0, null).getSW());
    }

    @Test
    void unknownInsIs6D00() {
        CardHarness.fresh().assertSw(0x6D00, 0x7E, 0, 0, null);
    }

    @Test
    void createdStateBlocksOtherCommands() {
        CardHarness.fresh().assertSw(0x6985, 0x20, 0, 0,
                CardHarness.PIN.getBytes(StandardCharsets.US_ASCII));
    }
}

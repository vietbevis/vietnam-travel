package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class TestServerTest {
    @Test
    void keyMaterialHasExpectedSizes() {
        assertEquals(128, TestServer.modulus().length);
        assertEquals(128, TestServer.sign(new byte[] {1}).length);
        assertEquals(16, TestServer.escrowKey(CardHarness.CARD_ID).length);
    }
}

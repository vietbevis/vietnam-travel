package vn.travel.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class HexTest {
    @Test void roundTrip() { assertEquals("80100000", Hex.encode(Hex.decode("80100000"))); }
    @Test void upperCaseOutput() { assertEquals("ABCDEF", Hex.encode(Hex.decode("abCDef"))); }
    @Test void oddLength() { assertThrows(IllegalArgumentException.class, () -> Hex.decode("801")); }
    @Test void badChar() { assertThrows(IllegalArgumentException.class, () -> Hex.decode("80ZZ")); }
}

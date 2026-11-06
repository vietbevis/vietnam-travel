package vn.travel.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

class SimCardPortTest {
    static final byte[] SELECT = Hex.decode("00A4040008F054524156454C01");
    static final byte[] INFO = Hex.decode("8010000000");

    static String swOf(byte[] r) {
        return Hex.encode(Arrays.copyOfRange(r, r.length - 2, r.length));
    }

    /** INIT (167 byte): cardId16 | type | modulus128 | pin6 | escrow16. Nội dung chỉ cần đúng kích thước. */
    static byte[] init() {
        byte[] d = new byte[167];
        Arrays.fill(d, 0, 16, (byte) 0x11);
        d[16] = 1;
        d[17] = (byte) 0xC5; // modulus có bit cao được đặt và là số lẻ
        d[17 + 127] = 1;
        System.arraycopy("482915".getBytes(), 0, d, 145, 6);
        Arrays.fill(d, 151, 167, (byte) 0x22);
        byte[] apdu = new byte[5 + d.length];
        apdu[0] = (byte) 0x80;
        apdu[1] = 0x01;
        apdu[4] = (byte) d.length;
        System.arraycopy(d, 0, apdu, 5, d.length);
        return apdu;
    }

    static byte[] verify() {
        return Hex.decode("8020000006" + Hex.encode("482915".getBytes()));
    }

    @Test void selectAndInfoOnBlankCard() throws Exception {
        var r = new SimCardPort(4).transmitBatch(List.of(SELECT, INFO));
        assertEquals(2, r.size());
        assertEquals("9000", swOf(r.get(1)));
        assertEquals(21, r.get(1).length - 2);
    }

    @Test void stopsAtFirstError() throws Exception {
        var r = new SimCardPort(4).transmitBatch(List.of(SELECT, Hex.decode("807E000000"), INFO));
        assertEquals(2, r.size());
        assertEquals("6D00", swOf(r.get(1)));
    }

    @Test void slotsAreIndependent() throws Exception {
        var p = new SimCardPort(4);
        var r = p.transmitBatch(List.of(SELECT, init(), INFO));
        assertEquals("9000", swOf(r.get(1)));
        byte stateSlot0 = r.get(2)[0];
        p.selectSlot(1);
        assertEquals(1, p.slot());
        var r1 = p.transmitBatch(List.of(SELECT, INFO));
        assertEquals("9000", swOf(r1.get(1)));
        assertEquals(0, r1.get(1)[0]);
        assertNotEquals(0, stateSlot0);
    }

    @Test void switchSlotResetsSession() throws Exception {
        var p = new SimCardPort(4);
        var r = p.transmitBatch(List.of(SELECT, init(), verify()));
        assertEquals("9000", swOf(r.get(2)));
        p.selectSlot(1);
        p.selectSlot(0);
        var after = p.transmitBatch(List.of(SELECT, Hex.decode("8040000000")));
        assertEquals(2, after.size());
        assertNotEquals("9000", swOf(after.get(1)));
    }

    @Test void resetSlotBlanksCard() throws Exception {
        var p = new SimCardPort(4);
        p.transmitBatch(List.of(SELECT, init()));
        p.resetSlot(0);
        var r = p.transmitBatch(List.of(SELECT, INFO));
        assertEquals(0, r.get(1)[0]);
    }

    @Test void selectSlotOutOfRange() {
        var p = new SimCardPort(4);
        assertThrows(IllegalArgumentException.class, () -> p.selectSlot(4));
        assertThrows(IllegalArgumentException.class, () -> p.selectSlot(-1));
    }

    @Test void pcscWithoutReaderThrowsNoCard() {
        assumeTrue(System.getenv("CI_HAS_READER") == null);
        var p = new PcscCardPort("does-not-exist");
        assertThrows(NoCardException.class, () -> p.transmitBatch(List.of(SELECT)));
        // lần gọi thứ hai thử lại (không giữ trạng thái cũ) và vẫn báo no-card, không bao giờ sập
        assertThrows(NoCardException.class, () -> p.transmitBatch(List.of(SELECT)));
        assertEquals(false, p.cardPresent());
    }
}

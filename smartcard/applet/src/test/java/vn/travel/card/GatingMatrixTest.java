package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.util.Set;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Spec 3.3 command-blocking matrix, written from the spec table (not from checkAllowed):
 * every INS x every card condition.
 */
class GatingMatrixTest {
    static final int[] ALL_INS = {
        0x01, 0x10, 0x20, 0x21, 0x22, 0x30, 0x31, 0x32, 0x40, 0x41, 0x42, 0x43,
        0x50, 0x51, 0x52, 0x53, 0x54, 0x60, 0x61, 0x62, 0x63, 0x70
    };
    static final Set<Integer> CUSTOMER_ONLY = Set.of(0x50, 0x51, 0x52, 0x53, 0x54, 0x60, 0x61, 0x62, 0x63);

    static final Set<Integer> IN_TERMINATED = Set.of(0x10);
    static final Set<Integer> IN_CREATED = Set.of(0x10, 0x01);
    static final Set<Integer> IN_LOCKED = Set.of(0x10, 0x30, 0x70);
    static final Set<Integer> IN_ACTIVE_MUST = Set.of(0x10, 0x20, 0x21, 0x22, 0x30, 0x32, 0x41, 0x42, 0x43, 0x70);
    // ACTIVE with mustChangePin = 0: every INS except 01.

    enum Cond {
        CREATED, ACTIVE_MUST, ACTIVE, LOCKED, TERMINATED;

        boolean allowed(int ins) {
            switch (this) {
                case CREATED: return IN_CREATED.contains(ins);
                case ACTIVE_MUST: return IN_ACTIVE_MUST.contains(ins);
                case ACTIVE: return ins != 0x01;
                case LOCKED: return IN_LOCKED.contains(ins);
                default: return IN_TERMINATED.contains(ins);
            }
        }
    }

    static CardHarness cardIn(Cond c, byte type) {
        CardHarness h = CardHarness.fresh();
        switch (c) {
            case CREATED:
                break;
            case ACTIVE_MUST:
                h.personalize(type);
                break;
            case ACTIVE:
                h.personalize(type);
                h.changePin(CardHarness.PIN, CardHarness.ACTIVE_PIN);
                break;
            case LOCKED:
                h.personalize(type);
                h.changePin(CardHarness.PIN, CardHarness.ACTIVE_PIN);
                assertEquals(0x9000, h.signed(0x70, 0x03, 0, new byte[0]).getSW());
                break;
            default:
                h.personalize(type);
                h.changePin(CardHarness.PIN, CardHarness.ACTIVE_PIN);
                assertEquals(0x9000, h.signed(0x70, 0x7F, 0, new byte[0]).getSW());
        }
        return h;
    }

    static Stream<Arguments> blocked() {
        Stream.Builder<Arguments> b = Stream.builder();
        for (Cond c : Cond.values()) {
            for (int ins : ALL_INS) {
                if (!c.allowed(ins)) {
                    b.add(Arguments.of(c, ins));
                }
            }
        }
        return b.build();
    }

    static Stream<Arguments> permitted() {
        Stream.Builder<Arguments> b = Stream.builder();
        for (Cond c : Cond.values()) {
            for (int ins : ALL_INS) {
                if (c.allowed(ins)) {
                    b.add(Arguments.of(c, ins));
                }
            }
        }
        return b.build();
    }

    @ParameterizedTest(name = "{0} blocks INS {1} with 6985")
    @MethodSource("blocked")
    void blockedCommandReturns6985(Cond c, int ins) {
        for (byte type : new byte[] {0x01, 0x02}) {
            if (c == Cond.CREATED && type == 0x02) {
                continue;
            }
            CardHarness h = cardIn(c, type);
            assertEquals(0x6985, h.send(ins, 0, 0, null).getSW(), () -> c + " type " + type);
        }
    }

    @ParameterizedTest(name = "{0} permits INS {1} (not 6985)")
    @MethodSource("permitted")
    void permittedCommandIsNotBlockedByState(Cond c, int ins) {
        CardHarness h = cardIn(c, (byte) 0x01);
        assertNotEquals(0x6985, h.send(ins, 0, 0, null).getSW());
    }

    static Stream<Arguments> customerOnlyOnStaff() {
        Stream.Builder<Arguments> b = Stream.builder();
        for (int ins : CUSTOMER_ONLY) {
            b.add(Arguments.of(ins));
        }
        return b.build();
    }

    @ParameterizedTest(name = "staff card ACTIVE rejects customer-only INS {0} with 6986")
    @MethodSource("customerOnlyOnStaff")
    void customerOnlyOnStaffCardReturns6986(int ins) {
        CardHarness h = cardIn(Cond.ACTIVE, (byte) 0x02);
        assertEquals(0x6986, h.send(ins, 0, 0, null).getSW());
    }

    @ParameterizedTest(name = "staff card keeps the common commands: INS {0}")
    @org.junit.jupiter.params.provider.ValueSource(ints = {0x10, 0x20, 0x30, 0x32, 0x40, 0x41})
    void staffCardIsNotRejectedAsWrongType(int ins) {
        CardHarness h = cardIn(Cond.ACTIVE, (byte) 0x02);
        assertNotEquals(0x6986, h.send(ins, 0, 0, null).getSW());
    }

    @org.junit.jupiter.api.Test
    void unknownInsOnActiveCardIs6D00() {
        Supplier<CardHarness> s = () -> cardIn(Cond.ACTIVE, (byte) 0x01);
        assertEquals(0x6D00, s.get().send(0x99, 0, 0, null).getSW());
    }
}

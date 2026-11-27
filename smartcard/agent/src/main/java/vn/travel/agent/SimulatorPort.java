package vn.travel.agent;

/** Các thao tác quản lý khe chỉ có trên đầu đọc mô phỏng. */
interface SimulatorPort extends CardPort {
    int slotCount();
    void selectSlot(int slot);
    void resetSlot(int slot);
}

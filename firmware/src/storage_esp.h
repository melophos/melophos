#pragma once

#include <esp_partition.h>

#include "hal.h"

namespace melophos {

// A named data partition as NOR flash. This is the only place that touches
// the flash API, so everything above it runs unchanged in the host tests.
class PartitionFlash : public Flash {
   public:
    // type 0x40 and 0x41 are the custom data subtypes in partitions.csv
    bool begin(uint8_t subtype, const char *label);
    uint32_t sectorSize() const override { return 4096; }
    uint32_t sectorCount() const override { return part_ ? part_->size / 4096 : 0; }
    bool erase(uint32_t sector) override;
    bool read(uint32_t address, void *out, size_t length) const override;
    bool program(uint32_t address, const void *data, size_t length) override;

   private:
    const esp_partition_t *part_ = nullptr;
};

}  // namespace melophos

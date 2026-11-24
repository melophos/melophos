#include "storage_esp.h"

namespace melophos {

bool PartitionFlash::begin(uint8_t subtype, const char *label) {
    part_ = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)subtype, label);
    return part_ != nullptr;
}

bool PartitionFlash::erase(uint32_t sector) {
    return part_ && sector < sectorCount() && esp_partition_erase_range(part_, sector * 4096, 4096) == ESP_OK;
}

bool PartitionFlash::read(uint32_t address, void *out, size_t length) const {
    return part_ && (uint64_t)address + length <= part_->size && esp_partition_read(part_, address, out, length) == ESP_OK;
}

bool PartitionFlash::program(uint32_t address, const void *data, size_t length) {
    return part_ && (uint64_t)address + length <= part_->size &&
           esp_partition_write(part_, address, data, length) == ESP_OK;
}

}  // namespace melophos

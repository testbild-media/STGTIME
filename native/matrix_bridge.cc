#include "led-matrix.h"
#include <arpa/inet.h>
#include <cstdint>
#include <iostream>
#include <memory>
#include <vector>

using rgb_matrix::FrameCanvas;
using rgb_matrix::RGBMatrix;

static bool read_exact(char* target, std::size_t length) {
  std::cin.read(target, static_cast<std::streamsize>(length));
  return static_cast<std::size_t>(std::cin.gcount()) == length;
}

int main(int argc, char** argv) {
  RGBMatrix::Options options;
  rgb_matrix::RuntimeOptions runtime;
  options.rows = 32;
  options.cols = 64;
  options.chain_length = 1;
  options.hardware_mapping = "regular";
  runtime.gpio_slowdown = 5;
  std::unique_ptr<RGBMatrix> matrix(RGBMatrix::CreateFromFlags(&argc, &argv, &options, &runtime));
  if (!matrix) return 1;
  FrameCanvas* canvas = matrix->CreateFrameCanvas();
  const std::size_t expected = static_cast<std::size_t>(matrix->width() * matrix->height() * 3);
  std::vector<uint8_t> pixels(expected);
  while (true) {
    uint32_t network_length = 0;
    if (!read_exact(reinterpret_cast<char*>(&network_length), sizeof(network_length))) break;
    const uint32_t length = ntohl(network_length);
    if (length != expected || !read_exact(reinterpret_cast<char*>(pixels.data()), expected)) break;
    for (int y = 0; y < matrix->height(); ++y) for (int x = 0; x < matrix->width(); ++x) {
      const auto offset = static_cast<std::size_t>((y * matrix->width() + x) * 3);
      canvas->SetPixel(x, y, pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    }
    canvas = matrix->SwapOnVSync(canvas);
  }
  matrix->Clear();
  return 0;
}

# STGTIME

STGTIME is a DIY countdown timer designed for use on stages and at conferences. It’s also known as a speech time display. The system is based on Node.js and an RGB HUB75 display.

A web-based GUI is available for control and configuration, and the device can be controlled via its API using Bitfocus Companion. You also can plugin a Stream Deck into one of the USB Ports to get direct control. (e.g. for local use only/DJ Timer)

In addition to the main speech timer, there is a second display that can show timing cues for videos or other events. This display is triggered via Companion triggers, but the video timer row can also be hidden if not needed.
There is also a permanent clock display that shows the current time.

Both the speech timer and the video cue timer include a progress bar to give a visual sense of the remaining time.

## Example
| Image | Note |
|:-:|:-|
| ![Example](https://github.com/testbild-media/STGTIME/blob/main/images/clock_display.jpeg) | On top: the main countdown/timer with a large progress bar.<br><br>Second line: a smaller video timer with its own progress bar, which can be hidden if not needed.<br><br>Bottom line: the current time is always displayed.<br><br>Both the colors and timing behavior of the progress bar can be customized via the Web GUI.<br>The progress bar is automatically calculated by the server based on the total duration and the remaining time for both. |
| ![Example](https://github.com/testbild-media/STGTIME/blob/main/images/3D_Model.jpg) | This is the current state of the 3D model. |

## Devices needed:
| Device | Link |
|:-|:-|
| Raspberry Pi 4 2/4GB | https://www.berrybase.de/raspberry-pi-4-computer-modell-b-4gb-ram |
| Waveshare RGB LED Matrix Panel 64×32 3mm Pitch | https://www.amazon.de/dp/B0B5N5HPKX |
| Seengreat RGB Matrix Adapter Board Rev 3.6 | https://www.amazon.de/dp/B0BC8Y447G |
| Power Supply 5V >5A | https://www.amazon.de/dp/B019GUOV40 |

## ToDo's
| Task                              | Status | Note |
|-----------------------------------|--------|------|
| Build Node.js server              | ✅     | Node.js server is running |
| Implement canvas-based rendering  | ✅     | Canvas rendering works as expected |
| Integrate matrix display          | ✅     | Matrix display is functional |
| Implement relay for display       | ❌     | The display shows visual artifacts on boot. Add a relay to disable the display during system startup. |
| Develop API interface             | ✅     | Partially done – exploring some new ideas |
| Create Bitfocus Companion module  | ✅     | Functionally done – final testing pending. |
| Build web-based GUI               | ✅     | Basic GUI is in place – needs styling improvements |
| Integrate StreamDeck direct connection | ❌     | Used for direct control without GUI or companion |
| Upload code to github             | ❌     | Hate to public unfinished code :D |
| Refactor and clean up code        | ❌     | Waiting until final tests are completed |
| Design 3D-printable housing       | ✅     | Minor adjustments still needed |
| Perform cold tests (offline testing) | 🔁  | In progress during hardware assembly |
| Assemble final product            | ❌     | Waiting for completion of other tasks |
| create wiki                       | ❌     | |
| create .img for easy install      | ❌     | |

## License
This project is licensed under a modified MIT License.  
You may use, modify, and distribute the Software for personal or non-commercial use, including renting devices with the Software installed.  
**Commercial distribution or sale as part of a product or service is not allowed without explicit permission.**  
See the [LICENSE](./LICENSE) file for full terms.

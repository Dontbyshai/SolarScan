# Runtime hook PyInstaller : enregistrer les opérateurs C++ de torchvision
# (torchvision::nms, etc.) AVANT qu'ultralytics ne lance une inférence.
# Sans ça, le paquet gelé charge YOLO puis plante : "operator torchvision::nms
# does not exist" — les libs _C_stable ne sont pas importées comme un module
# Python, elles le sont via torch.ops.load_library.

import torch  # noqa: F401
import torchvision  # noqa: F401
import torchvision.ops  # noqa: F401

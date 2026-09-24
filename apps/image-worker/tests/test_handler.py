"""
Testes do handler de capas sem GPU: torch, diffusers e runpod viram dublês.

Cobre a fiação (validação, parâmetros que chegam ao pipeline, formato da
resposta). A qualidade da capa só se vê gerando numa GPU.

Rodar:  python -m unittest discover -s apps/image-worker/tests -v
"""

from __future__ import annotations

import base64
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

HANDLER = Path(__file__).resolve().parent.parent / "handler.py"


class FakeImage:
    def save(self, buffer, format, quality, optimize):  # noqa: A002 — assinatura do PIL
        buffer.write(f"JPEG q={quality}".encode())


def load_handler(captured: dict):
    class FakePipe:
        @classmethod
        def from_pretrained(cls, path, torch_dtype):
            captured["loaded_from"] = path
            captured["dtype"] = torch_dtype
            return cls()

        def to(self, device):
            captured["device"] = device
            return self

        def __call__(self, **kwargs):
            captured["call"] = kwargs
            return types.SimpleNamespace(images=[FakeImage()])

    class FakeGenerator:
        def __init__(self, device):
            self.device = device

        def manual_seed(self, seed):
            captured["seed"] = seed
            return self

    cuda = types.SimpleNamespace(is_available=lambda: False, get_device_name=lambda _i: "fake")
    torch = types.ModuleType("torch")
    torch.cuda = cuda
    torch.cuda.OutOfMemoryError = type("OutOfMemoryError", (RuntimeError,), {})
    torch.bfloat16 = "bf16"
    torch.Generator = FakeGenerator

    stubs = {
        "torch": torch,
        "runpod": types.SimpleNamespace(serverless=types.SimpleNamespace(start=lambda _c: None)),
        "diffusers": types.SimpleNamespace(Flux2KleinPipeline=FakePipe),
    }
    with mock.patch.dict(sys.modules, stubs):
        spec = importlib.util.spec_from_file_location("image_handler_under_test", HANDLER)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    return mod


class Handler(unittest.TestCase):
    def setUp(self):
        self.captured: dict = {}
        self.h = load_handler(self.captured)

    def test_carrega_o_klein_em_bf16_da_pasta_da_imagem(self):
        self.assertEqual(self.captured["loaded_from"], "/models/flux2-klein-4b")
        self.assertEqual(self.captured["dtype"], "bf16")
        self.assertEqual(self.h.WORKER_INFO["model"], "FLUX.2-klein-4B")

    def test_gera_com_os_parametros_do_klein_e_devolve_jpeg_em_base64(self):
        out = self.h.handler({"input": {"prompt": "capa de synthwave", "seed": 7}})

        call = self.captured["call"]
        self.assertEqual(call["num_inference_steps"], 4)
        self.assertEqual(call["guidance_scale"], 1.0)
        self.assertEqual((call["width"], call["height"]), (1024, 1024))
        self.assertEqual(self.captured["seed"], 7)

        self.assertEqual(out["mime_type"], "image/jpeg")
        self.assertEqual(base64.b64decode(out["image_base64"]), b"JPEG q=90")
        self.assertEqual(out["seed"], 7)
        self.assertTrue(out["worker"]["cold_start"])
        self.assertFalse(self.h.handler({"input": {"prompt": "x"}})["worker"]["cold_start"])

    def test_sem_seed_sorteia_uma_e_devolve_qual_foi(self):
        out = self.h.handler({"input": {"prompt": "x"}})
        self.assertIsInstance(out["seed"], int)
        self.assertEqual(out["seed"], self.captured["seed"])

    def test_entradas_invalidas_sao_recusadas_sem_gerar(self):
        casos = [
            ({}, "prompt"),
            ({"prompt": "x" * 2001}, "2000"),
            ({"prompt": "x", "width": 1000}, "múltiplos de 16"),
            ({"prompt": "x", "width": 4096}, "width"),
            ({"prompt": "x", "steps": 20}, "steps"),
            ({"prompt": "x", "seed": "abc"}, "seed"),
        ]
        for entrada, trecho in casos:
            with self.subTest(entrada=entrada):
                self.captured.pop("call", None)
                out = self.h.handler({"input": entrada})
                self.assertTrue(out["error"].startswith("entrada inválida"))
                self.assertIn(trecho, out["error"])
                self.assertNotIn("call", self.captured)

    def test_falha_na_geracao_vira_erro_legivel(self):
        with mock.patch.object(self.h, "PIPE", side_effect=RuntimeError("CUDA quebrou")):
            out = self.h.handler({"input": {"prompt": "x"}})
        self.assertIn("CUDA quebrou", out["error"])


if __name__ == "__main__":
    unittest.main()

"""
Testes do handler sem GPU: os módulos pesados (torch, acestep, runpod...) são
trocados por dublês antes de importar o handler.

O que isto cobre é a FIAÇÃO — que perfil de difusão cada modelo recebe, que o
negativo chega ao LM, que duas variantes viram duas faixas. A qualidade do
áudio em si só se mede numa GPU.

Rodar:  python -m unittest discover -s apps/gpu-worker/tests -v
"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

HANDLER = Path(__file__).resolve().parent.parent / "handler.py"


class Recorder:
    """GenerationParams/GenerationConfig falsos: guardam o que receberam."""

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _stub_modules(captured: dict, audios: list[dict] | None = None) -> dict[str, types.ModuleType]:
    def module(name: str, **attrs) -> types.ModuleType:
        mod = types.ModuleType(name)
        mod.__dict__.update(attrs)
        return mod

    class FakeDit:
        def initialize_service(self, **kwargs):
            captured["dit_init"] = kwargs
            return "ok", True

        def convert_src_audio_to_codes(self, _path):
            return "codes"

    class FakeLlm:
        def initialize(self, **kwargs):
            captured["lm_init"] = kwargs
            return "ok", True

    def generate_music(dit_handler, llm_handler, params, config, save_dir):
        captured["params"] = params
        captured["config"] = config
        return types.SimpleNamespace(
            success=True,
            error=None,
            status_message="",
            audios=audios if audios is not None else [],
            extra_outputs={"lm_metadata": {"bpm": 100}},
        )

    cuda = types.SimpleNamespace(
        is_available=lambda: False,
        get_device_name=lambda _i: "fake",
    )
    torch = module("torch", cuda=cuda)
    torch.cuda.OutOfMemoryError = type("OutOfMemoryError", (RuntimeError,), {})

    return {
        "requests": module("requests", RequestException=Exception, get=None, put=None),
        "runpod": module("runpod", serverless=types.SimpleNamespace(start=lambda _c: None)),
        "soundfile": module("soundfile"),
        "torch": torch,
        "acestep": module("acestep"),
        "acestep.constants": module(
            "acestep.constants", TASK_INSTRUCTIONS={"text2music": "instr", "cover": "c", "repaint": "r"}
        ),
        "acestep.handler": module("acestep.handler", AceStepHandler=FakeDit),
        "acestep.inference": module(
            "acestep.inference",
            GenerationConfig=Recorder,
            GenerationParams=Recorder,
            generate_music=generate_music,
        ),
        "acestep.llm_inference": module("acestep.llm_inference", LLMHandler=FakeLlm),
    }


def load_handler(env: dict[str, str] | None = None, captured: dict | None = None, audios=None):
    """Importa o handler.py do zero, com dublês e as variáveis de ambiente dadas."""
    captured = captured if captured is not None else {}
    stubs = _stub_modules(captured, audios)
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("ACESTEP_")}
    clean_env.update(env or {})

    with mock.patch.dict(sys.modules, stubs), mock.patch.dict(os.environ, clean_env, clear=True):
        spec = importlib.util.spec_from_file_location("handler_under_test", HANDLER)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    return mod


DEFAULT = {}  # o padrão do handler: xl-turbo + LM 1.7B
SFT = {"ACESTEP_CONFIG_PATH": "acestep-v15-xl-sft"}  # fora do padrão: soou pior na escuta
TURBO = {"ACESTEP_CONFIG_PATH": "acestep-v15-turbo", "ACESTEP_LM_MODEL_PATH": "acestep-5Hz-lm-1.7B"}
DOCKERFILE = HANDLER.parent / "Dockerfile"


def req(**extra) -> dict:
    return {"caption": "forró pé de serra", "uploads": [{"url": "u", "storage_key": "k"}], **extra}


class ModelSettings(unittest.TestCase):
    def test_padrao_e_xl_turbo_com_lm_1_7b(self):
        """A configuração dos jobs F-0/F-1 do benchmark, a única que soou limpa na escuta."""
        captured: dict = {}
        h = load_handler(DEFAULT, captured)

        self.assertEqual(h.CONFIG_PATH, "acestep-v15-xl-turbo")
        self.assertEqual(h.LM_MODEL_PATH, "acestep-5Hz-lm-1.7B")
        self.assertEqual(captured["dit_init"]["config_path"], "acestep-v15-xl-turbo")
        self.assertEqual(captured["lm_init"]["lm_model_path"], "acestep-5Hz-lm-1.7B")
        self.assertFalse(h.OFFLOAD_TO_CPU)
        self.assertTrue(h.COT_CAPTION)
        self.assertEqual(h.WORKER_INFO["profile"], "turbo")

    def test_padrao_usa_o_perfil_do_turbo_medido_no_benchmark(self):
        h = load_handler(DEFAULT)
        s = h._model_settings(h._parse_input(req(negative_caption="funk, dubstep")))

        self.assertEqual(s["inference_steps"], 8)
        self.assertEqual(s["timesteps"], h.TURBO_TIMESTEPS)
        self.assertEqual(s["lm_temperature"], 0.85)
        self.assertEqual(s["lm_cfg_scale"], 2.0)
        # O que evitar chega ao LM: foi assim no job F.
        self.assertEqual(s["lm_negative_prompt"], "funk, dubstep")

    def test_no_padrao_os_controles_de_estilo_e_variedade_nao_mexem_no_modelo(self):
        """Sem CFG no turbo, "aderência ao estilo" não tem o que controlar: fica registrado."""
        h = load_handler(DEFAULT)
        base = h._model_settings(h._parse_input(req()))
        moved = h._model_settings(h._parse_input(req(style_influence=100, variety="low")))

        self.assertEqual(base, moved)

    def test_dockerfile_e_handler_concordam_no_modelo(self):
        """Se um mudar sem o outro, a imagem sobe com um modelo e o código assume outro."""
        text = DOCKERFILE.read_text(encoding="utf-8")
        h = load_handler(DEFAULT)

        def env(name: str) -> str:
            import re

            return re.search(rf"^\s*(?:ENV\s+)?{name}=(\S+)", text, re.M).group(1)

        self.assertEqual(env("ACESTEP_CONFIG_PATH"), h.CONFIG_PATH)
        self.assertEqual(env("ACESTEP_LM_MODEL_PATH"), h.LM_MODEL_PATH)
        # O que o Dockerfile usa de padrão tem que estar baixado na imagem.
        self.assertIn(f"--model {h.CONFIG_PATH}", text)

    def test_sft_usa_50_passos_shift_3_e_nunca_o_cronograma_do_turbo(self):
        h = load_handler(SFT)
        s = h._model_settings(h._parse_input(req()))

        self.assertEqual(s["inference_steps"], 50)
        self.assertEqual(s["shift"], 3.0)
        # timesteps sobrepõe passos e shift: se o do turbo vazasse, o SFT rodaria 8 passos.
        self.assertIsNone(s["timesteps"])

    def test_aderencia_ao_estilo_vira_cfg_na_faixa_recomendada(self):
        h = load_handler(SFT)
        cfg = lambda si: h._model_settings(h._parse_input(req(style_influence=si)))["guidance_scale"]

        self.assertEqual(cfg(0), 5.0)
        self.assertEqual(cfg(50), 7.0)  # o padrão do ACE-Step
        self.assertEqual(cfg(100), 9.0)

    def test_sem_style_influence_vale_o_padrao(self):
        h = load_handler(SFT)
        self.assertEqual(h._model_settings(h._parse_input(req()))["guidance_scale"], 7.0)

    def test_variedade_vira_temperatura_do_lm_sem_passar_de_085(self):
        h = load_handler(SFT)
        temp = lambda v: h._model_settings(h._parse_input(req(variety=v)))["lm_temperature"]

        self.assertEqual(temp("low"), 0.7)
        self.assertEqual(temp("medium"), 0.8)
        self.assertEqual(temp("high"), 0.85)

    def test_o_que_evitar_vai_para_o_negativo_do_lm_e_o_cfg_do_lm_fica_acima_de_1(self):
        h = load_handler(SFT)
        s = h._model_settings(h._parse_input(req(negative_caption="heavy metal, distorted guitars")))

        self.assertEqual(s["lm_negative_prompt"], "heavy metal, distorted guitars")
        self.assertGreater(s["lm_cfg_scale"], 1.0)

    def test_sem_exclusao_usa_o_sentinela_do_acestep(self):
        h = load_handler(SFT)
        self.assertEqual(h._model_settings(h._parse_input(req()))["lm_negative_prompt"], "NO USER INPUT")

    def test_turbo_mantem_a_configuracao_medida(self):
        h = load_handler(TURBO)
        s = h._model_settings(h._parse_input(req(style_influence=100, variety="low")))

        self.assertEqual(s["inference_steps"], 8)
        self.assertEqual(s["timesteps"], h.TURBO_TIMESTEPS)
        self.assertNotIn("shift", s)
        # Os controles da UI não mexem no turbo: é a configuração em que o ritmo foi medido.
        self.assertEqual(s["lm_temperature"], 0.85)
        self.assertEqual(s["lm_cfg_scale"], 2.0)

    def test_passos_do_sft_podem_ser_mudados_por_env(self):
        h = load_handler({**SFT, "ACESTEP_SFT_STEPS": "32"})
        self.assertEqual(h._model_settings(h._parse_input(req()))["inference_steps"], 32)


class InputValidation(unittest.TestCase):
    def setUp(self):
        self.h = load_handler(SFT)

    def test_duas_variantes_pedem_dois_destinos(self):
        parsed = self.h._parse_input(
            req(batch_size=2, uploads=[{"url": "a", "storage_key": "1"}, {"url": "b", "storage_key": "2"}])
        )
        self.assertEqual(parsed["batch_size"], 2)

        with self.assertRaisesRegex(self.h.InputError, "um destino por variação"):
            self.h._parse_input(req(batch_size=2))

    def test_lote_so_em_text2music(self):
        uploads = [{"url": "a", "storage_key": "1"}, {"url": "b", "storage_key": "2"}]
        with self.assertRaisesRegex(self.h.InputError, "aceita só batch_size 1"):
            self.h._parse_input(req(task_type="cover", src_audio_url="http://x", batch_size=2, uploads=uploads))

    def test_tres_faixas_nao(self):
        with self.assertRaisesRegex(self.h.InputError, "entre 1 e 2"):
            self.h._parse_input(req(batch_size=3))

    def test_valores_invalidos_sao_recusados(self):
        with self.assertRaisesRegex(self.h.InputError, "variety"):
            self.h._parse_input(req(variety="extreme"))
        with self.assertRaisesRegex(self.h.InputError, "style_influence"):
            self.h._parse_input(req(style_influence=101))
        with self.assertRaisesRegex(self.h.InputError, "negative_caption"):
            self.h._parse_input(req(negative_caption="x" * 513))


class HandlerWiring(unittest.TestCase):
    """O handler inteiro, com o gerador falso devolvendo dois áudios."""

    def run_handler(self, env, payload):
        tmp = tempfile.mkdtemp()
        wavs = []
        for i in range(2):
            path = Path(tmp) / f"a{i}.wav"
            path.write_bytes(b"wav")
            wavs.append({"path": str(path), "params": {"seed": 100 + i}})

        captured: dict = {}
        h = load_handler(env, captured, audios=wavs)

        def fake_flac(_wav, flac_path):
            Path(flac_path).write_bytes(b"flac")
            return {"duration_ms": 30_000, "sample_rate": 48_000, "bit_depth": 24}

        uploaded: list[str] = []
        with mock.patch.object(h, "_to_flac_24", fake_flac), mock.patch.object(
            h, "_upload", lambda _path, url: uploaded.append(url)
        ):
            return h.handler({"input": payload}), captured, uploaded

    def test_duas_variantes_saem_como_duas_faixas_nos_destinos_pedidos(self):
        out, captured, uploaded = self.run_handler(
            SFT,
            req(
                batch_size=2,
                uploads=[{"url": "u1", "storage_key": "songs/a/master.flac"}, {"url": "u2", "storage_key": "songs/b/master.flac"}],
                negative_caption="reggaeton",
                style_influence=80,
                seed=7,
            ),
        )

        self.assertNotIn("error", out)
        self.assertEqual([t["storage_key"] for t in out["tracks"]], ["songs/a/master.flac", "songs/b/master.flac"])
        self.assertEqual([t["seed"] for t in out["tracks"]], [100, 101])
        self.assertEqual(uploaded, ["u1", "u2"])

        params, config = captured["params"], captured["config"]
        self.assertEqual(config.batch_size, 2)
        self.assertEqual(config.seeds, [7, 8])
        self.assertEqual(params.inference_steps, 50)
        self.assertIsNone(params.timesteps)
        self.assertEqual(params.lm_negative_prompt, "reggaeton")
        self.assertEqual(params.guidance_scale, 8.2)
        self.assertTrue(params.thinking)  # sem thinking o ritmo se perde

        self.assertEqual(out["metadata"]["settings"]["inference_steps"], 50)
        self.assertTrue(out["metadata"]["negative_applied"])
        self.assertEqual(out["worker"]["profile"], "sft-50steps")

    def test_uma_variante_so(self):
        out, captured, _ = self.run_handler(SFT, req())
        # O gerador falso devolve 2 áudios; o handler exige o que foi pedido e usa os destinos dados.
        self.assertEqual(len(out["tracks"]), 1)
        self.assertEqual(captured["config"].batch_size, 1)

    def test_reescrita_do_caption_pelo_lm_liga_por_padrao_e_desliga_por_env(self):
        _, captured, _ = self.run_handler(SFT, req())
        self.assertTrue(captured["params"].use_cot_caption)

        _, captured, _ = self.run_handler({"ACESTEP_COT_CAPTION": "false"}, req())
        self.assertFalse(captured["params"].use_cot_caption)
        # Desligar a reescrita não pode desligar o thinking: sem ele o ritmo se perde.
        self.assertTrue(captured["params"].thinking)

    def test_turbo_segue_com_o_cronograma_de_8_passos(self):
        _, captured, _ = self.run_handler(TURBO, req())
        self.assertEqual(captured["params"].inference_steps, 8)
        self.assertEqual(len(captured["params"].timesteps), 9)

    def test_padrao_reproduz_o_job_f_do_benchmark(self):
        """Mesma entrada do job F (2 faixas, exclusões no negativo): mesmos parâmetros no ACE-Step."""
        out, captured, _ = self.run_handler(
            DEFAULT,
            req(
                batch_size=2,
                uploads=[{"url": "u1", "storage_key": "a.flac"}, {"url": "u2", "storage_key": "b.flac"}],
                negative_caption="spoken word, choir, rap",
                instrumental=True,
                seed=42,
            ),
        )

        self.assertNotIn("error", out)
        self.assertEqual(out["worker"]["profile"], "turbo")
        self.assertEqual(out["worker"]["dit"], "acestep-v15-xl-turbo")
        self.assertEqual(out["worker"]["lm"], "acestep-5Hz-lm-1.7B")

        params, config = captured["params"], captured["config"]
        self.assertEqual(params.inference_steps, 8)
        self.assertEqual(params.timesteps, [0.97, 0.76, 0.615, 0.5, 0.395, 0.28, 0.18, 0.085, 0.0])
        self.assertEqual(params.lm_temperature, 0.85)
        self.assertEqual(params.lm_cfg_scale, 2.0)
        self.assertEqual(params.lm_negative_prompt, "spoken word, choir, rap")
        self.assertTrue(params.thinking)
        self.assertTrue(params.use_cot_caption)
        self.assertEqual((config.batch_size, config.seeds), (2, [42, 43]))


if __name__ == "__main__":
    unittest.main()

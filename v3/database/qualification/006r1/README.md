# Qualification de la 006 révisée (reproductible)

```sh
./build_templates.sh                                   # b005, b006 (référence), s1
T=../../tests
python3 run_archived.py s1 $T/lot2_financial_model_local.sql $T/lot2_specs.json final_s1_lot2_run1
python3 run_archived.py s1 variants/generated/lot1_post006_variante_F3.sql variants/generated/lot1_post006_variante_F3_specs.json final_s1_lot1post006_varF3_run1
python3 run_archived.py s1 $T/lot1_post006.sql $T/lot1_post006_specs.json final_s1_lot1post006_original_run1   # refus attendu (F3)
python3 qualify006.py s1 final_s1_indep_run1           # C01 et C07a : échecs historiques attendus (CF-06)
python3 deep006r1.py s1 final_s1_deep_run1             # 38/38 ; sur b006 : échecs des défauts corrigés
python3 deep006r1.py b006 orig006_deep_run1
RB_TAG=_final python3 qualify_rollback.py              # RB1 ×3, RB2–RB5
```

Les résultats bruts (`results/*.json`) donnent, contrôle par contrôle, l'attendu, l'observé (SQLSTATE et message) et le statut. Les suites historiques (`../../tests/`) ne sont pas modifiées. Les variantes (`variants/`) sont produites par des substitutions assertées et journalisées (`variants_log.json`).

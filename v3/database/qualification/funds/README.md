# Qualification des fonds réels (reproductible)

```sh
../006r1/build_templates.sh && ../lot3/build_templates.sh && ./build_templates.sh
python3 test_funds_final.py s3 final_s3_funds_run1             # 30 contrôles (R-B0, R-B1, R-B3 à R-B6, V2)
```
`v2_to_v3_plan.py` ne lit qu'une base V2 SQLite fournie en argument ; les tests utilisent une base synthétique (membres fictifs).

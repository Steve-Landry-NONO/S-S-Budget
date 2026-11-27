# Qualification du lot 3 (reproductible)

```sh
../006r1/build_templates.sh && ./build_templates.sh
python3 qualify_lot3_decisions.py s2 final_s2_lot3dec_run1    # R-A3, R-C1 à R-C5, X18b
python3 qualify_lot3_v3.py s2 final_s2_lot3v3_run1            # ajouts v3 (C3-*)
python3 qualify_lot3_v2.py s2 final_s2_lot3v2suite            # suite v2 historique, inchangée
python3 ../006r1/run_archived.py s2 ../006r1/variants/generated/lot2_financial_model_local_variante_CF05.sql ../006r1/variants/generated/lot2_variante_CF05_specs.json final_s2_lot2_varCF05_run1   # X18 : échec attendu
```
`composition/` contient les deux sources (v2 du 25/11 et ajouts) et le script qui compose la migration ; la migration publiée est le fichier composé.

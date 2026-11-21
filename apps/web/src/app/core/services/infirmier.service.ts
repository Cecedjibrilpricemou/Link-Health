// core/services/infirmier.service.ts
// L'espace de l'infirmier : les patients en visite, le dossier de la visite,
// et ses passages. Il soigne sans prescrire : rien ici n'ecrit une ordonnance.
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  CreerSoinInfirmierDto,
  DossierVisiteInfirmierView,
  PatientEnVisiteView,
  SoinInfirmierView,
} from '@baobaoheath/shared-types';
import { ApiService } from './api.service';
import type { ApiResponse } from '../models/api.model';

@Injectable({ providedIn: 'root' })
export class InfirmierService {
  private readonly api = inject(ApiService);

  patients(): Observable<ApiResponse<PatientEnVisiteView[]>> {
    return this.api.get<ApiResponse<PatientEnVisiteView[]>>('/infirmier/patients');
  }

  visite(idEpisode: string): Observable<ApiResponse<DossierVisiteInfirmierView>> {
    return this.api.get<ApiResponse<DossierVisiteInfirmierView>>(`/infirmier/visites/${idEpisode}`);
  }

  noterSoin(idEpisode: string, dto: CreerSoinInfirmierDto): Observable<ApiResponse<SoinInfirmierView>> {
    return this.api.post<ApiResponse<SoinInfirmierView>>(`/infirmier/visites/${idEpisode}/soins`, dto);
  }
}

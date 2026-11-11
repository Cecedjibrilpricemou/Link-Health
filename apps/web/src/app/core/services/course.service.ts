import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ApiResponse,
  ChoisirOffreCourseDto,
  CourseLivreurView,
  CourseView,
  LivreurZoneView,
  MesCoursesLivreurView,
  OffreCourseView,
  ProposerOffreCourseDto,
  RenoncerALaLivraisonDto,
  RemettreAuMotardDto,
} from '@baobaoheath/shared-types';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class CourseService {
  private readonly api = inject(ApiService);

  coursesOuvertes(): Observable<ApiResponse<CourseLivreurView[]>> {
    return this.api.get<ApiResponse<CourseLivreurView[]>>('/courses/ouvertes');
  }

  mesCourses(): Observable<ApiResponse<MesCoursesLivreurView>> {
    return this.api.get<ApiResponse<MesCoursesLivreurView>>('/courses/mes-courses');
  }

  /** Disponibilite et zone du motard connecte (M4). */
  profilLivreur(): Observable<ApiResponse<LivreurZoneView>> {
    return this.api.get<ApiResponse<LivreurZoneView>>('/courses/livreur/profil');
  }

  /** Entrer en service ou en sortir : seul un motard en service est prevenu des courses. */
  definirEnService(enService: boolean): Observable<ApiResponse<LivreurZoneView>> {
    return this.api.put<ApiResponse<LivreurZoneView>>('/courses/livreur/service', { enService });
  }

  /** Les communes desservies en plus de la sienne (5 au plus, verifie par l'API). */
  definirCommunes(communes: string[]): Observable<ApiResponse<LivreurZoneView>> {
    return this.api.put<ApiResponse<LivreurZoneView>>('/courses/livreur/communes', { communes });
  }

  proposer(idCourse: string, dto: ProposerOffreCourseDto): Observable<ApiResponse<OffreCourseView>> {
    return this.api.post<ApiResponse<OffreCourseView>>(`/courses/${idCourse}/offres`, dto);
  }

  offresCommande(idCommande: string): Observable<ApiResponse<OffreCourseView[]>> {
    return this.api.get<ApiResponse<OffreCourseView[]>>(`/courses/commande/${idCommande}/offres`);
  }

  choisirOffre(idCommande: string, dto: ChoisirOffreCourseDto): Observable<ApiResponse<CourseView>> {
    return this.api.post<ApiResponse<CourseView>>(`/courses/commande/${idCommande}/choisir`, dto);
  }

  declarerRecu(idCourse: string): Observable<ApiResponse<CourseView>> {
    return this.api.post<ApiResponse<CourseView>>(`/courses/${idCourse}/recu`, {});
  }

  renoncer(idCourse: string, dto: RenoncerALaLivraisonDto): Observable<ApiResponse<CourseView>> {
    return this.api.post<ApiResponse<CourseView>>(`/courses/${idCourse}/renoncer`, dto);
  }

  remettreAuMotard(idCourse: string, dto: RemettreAuMotardDto): Observable<ApiResponse<CourseView>> {
    return this.api.post<ApiResponse<CourseView>>(`/courses/${idCourse}/remettre`, dto);
  }
}
